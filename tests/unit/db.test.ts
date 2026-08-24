import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  db,
  createProject,
  listProjects,
  getProject,
  deleteProject,
  addClass,
  renameClass,
  reorderClasses,
  listClasses,
  deleteClass,
  addSample,
  addSampleBurst,
  listSamples,
  deleteSample,
  countSamplesByClass,
  markEmbeddingsStale,
  listStaleEmbeddingSamples,
  saveModel,
  loadModelRecord,
  markModelFailed,
  markModelReady,
  listStaleTrainingModels,
  cacheExplanation,
  findExplanation,
  pruneExplanations,
  estimateStorage,
  requestPersistence,
  StorageError,
  STORAGE_WARN_RATIO,
  STORAGE_REFUSE_RATIO,
} from '@/lib/db'

/**
 * T026 / contracts/storage.md D1–D10 / FR-049.
 *
 * This store holds the only copy of a learner's work. Nothing is backed up — that is the
 * privacy design, not an omission — so a bug here destroys captured samples
 * irrecoverably. Two obligations therefore get disproportionate attention:
 *
 * - **D7**, a quota error mid-burst: every sample already written survives and the
 *   reported count matches what was stored. Losing captured samples silently is the worst
 *   failure this product has.
 * - **D9**, two-owner isolation: shared devices are the norm in schools, so a learner
 *   must never see another account's local projects.
 */

const ALPHA = 0.5 as const

function embedding(size = 8, fill = 1): Float32Array {
  return new Float32Array(size).fill(fill)
}

function blob(bytes = 32): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('projects', () => {
  it('creates and lists a project for its owner', async () => {
    const project = await createProject('Fruit', 'owner-a')
    expect(project.id).toMatch(/[0-9a-f-]{36}/)
    expect(project.backboneAlpha).toBe(ALPHA)

    const listed = await listProjects('owner-a')
    expect(listed.map((p) => p.id)).toEqual([project.id])
  })

  it('refuses an empty or over-long name (data-model.md: 1–60 chars)', async () => {
    await expect(createProject('', 'owner-a')).rejects.toThrow()
    await expect(createProject('x'.repeat(61), 'owner-a')).rejects.toThrow()
  })

  it('D9: each owner sees only its own projects', async () => {
    const mine = await createProject('Mine', 'owner-a')
    await createProject('Yours', 'owner-b')

    const forA = await listProjects('owner-a')
    expect(forA.map((p) => p.id)).toEqual([mine.id])

    const forB = await listProjects('owner-b')
    expect(forB.map((p) => p.name)).toEqual(['Yours'])
  })

  it("D9: an anonymous session sees only null-owned projects, not a signed-in learner's", async () => {
    const anonymous = await createProject('Anonymous try', null)
    await createProject('Signed in', 'owner-a')

    const listed = await listProjects(null)
    expect(listed.map((p) => p.id)).toEqual([anonymous.id])
  })

  it("D9: getProject refuses to return another owner's project", async () => {
    const theirs = await createProject('Theirs', 'owner-b')
    await expect(getProject(theirs.id, 'owner-a')).resolves.toBeUndefined()
    await expect(getProject(theirs.id, 'owner-b')).resolves.toMatchObject({ name: 'Theirs' })
  })

  it('D1: deleteProject cascades to classes, samples, models and explanations', async () => {
    const project = await createProject('Doomed', 'owner-a')
    const klass = await addClass(project.id, 'Apple')
    const sample = await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })
    await saveModel({ runId: 'run-1', projectId: project.id, artifactKey: 'k', classOrder: [klass.id] })
    await cacheExplanation({
      runId: 'run-1',
      frameHash: 'hash',
      classId: klass.id,
      method: 'gradcam',
      map: new Float32Array(49),
      width: 7,
      height: 7,
      params: { targetLayer: 'conv_pw_13_relu' },
    })

    // A survivor in a second project proves the cascade is scoped, not a wipe.
    const other = await createProject('Survivor', 'owner-a')
    const otherClass = await addClass(other.id, 'Pear')

    await deleteProject(project.id)

    expect(await db.projects.get(project.id)).toBeUndefined()
    expect(await db.classes.where('projectId').equals(project.id).count()).toBe(0)
    expect(await db.samples.get(sample.id)).toBeUndefined()
    expect(await db.models.where('projectId').equals(project.id).count()).toBe(0)
    expect(await findExplanation({
      runId: 'run-1',
      frameHash: 'hash',
      classId: klass.id,
      method: 'gradcam',
      params: { targetLayer: 'conv_pw_13_relu' },
    })).toBeUndefined()

    expect(await db.classes.get(otherClass.id)).toBeDefined()
  })

  it('D1: a partially deleted project is never observable', async () => {
    // The saved-artifact removal runs first, before the metadata transaction, so a
    // refusal there leaves the project wholly intact. It cannot run *inside* the
    // transaction: awaiting a promise Dexie does not own lets the transaction commit
    // early, so an "atomic" delete including that step would quietly not be atomic.
    const project = await createProject('Atomic', 'owner-a')
    const klass = await addClass(project.id, 'Apple')
    await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })
    // A saved model is what gives `removeArtifact` something to refuse.
    await saveModel({ runId: 'run-1', projectId: project.id, artifactKey: 'k', classOrder: [klass.id] })

    await expect(
      deleteProject(project.id, {
        removeArtifact: () => Promise.reject(new Error('artifact store unavailable')),
      }),
    ).rejects.toThrow()

    expect(await db.projects.get(project.id)).toBeDefined()
    expect(await db.classes.where('projectId').equals(project.id).count()).toBe(1)
    expect(await db.samples.where('projectId').equals(project.id).count()).toBe(1)
  })
})

describe('classes', () => {
  it('refuses a duplicate name case-insensitively (D3, FR-001)', async () => {
    const project = await createProject('P', 'owner-a')
    await addClass(project.id, 'Apple')
    await expect(addClass(project.id, 'apple')).rejects.toThrow(/already/i)
    await expect(addClass(project.id, '  APPLE  ')).rejects.toThrow(/already/i)
  })

  it('allows the same class name in a different project', async () => {
    const a = await createProject('A', 'owner-a')
    const b = await createProject('B', 'owner-a')
    await addClass(a.id, 'Apple')
    await expect(addClass(b.id, 'Apple')).resolves.toBeDefined()
  })

  it('assigns increasing order values and lists in that order', async () => {
    const project = await createProject('P', 'owner-a')
    await addClass(project.id, 'One')
    await addClass(project.id, 'Two')
    await addClass(project.id, 'Three')
    expect((await listClasses(project.id)).map((c) => c.name)).toEqual(['One', 'Two', 'Three'])
  })

  it('reorders classes', async () => {
    const project = await createProject('P', 'owner-a')
    const a = await addClass(project.id, 'One')
    const b = await addClass(project.id, 'Two')
    const c = await addClass(project.id, 'Three')

    await reorderClasses(project.id, [c.id, a.id, b.id])
    expect((await listClasses(project.id)).map((k) => k.name)).toEqual(['Three', 'One', 'Two'])
  })

  it("refuses a reorder that does not name exactly the project's classes", async () => {
    // A partial list would silently drop a class off the end of the ordering.
    const project = await createProject('P', 'owner-a')
    const a = await addClass(project.id, 'One')
    await addClass(project.id, 'Two')
    await expect(reorderClasses(project.id, [a.id])).rejects.toThrow()
  })

  it('D2: renameClass changes only the name, leaving ids and samples attached', async () => {
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'Apple')
    const sample = await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })

    await renameClass(klass.id, 'Green apple')

    const renamed = await db.classes.get(klass.id)
    expect(renamed?.name).toBe('Green apple')
    expect(renamed?.id).toBe(klass.id)
    // A training run references classId, never the name, so its figures stay correctly
    // attributed after a rename (data-model.md, Edge Cases).
    expect((await db.samples.get(sample.id))?.classId).toBe(klass.id)
  })

  it('refuses a rename that collides with a sibling, case-insensitively', async () => {
    const project = await createProject('P', 'owner-a')
    await addClass(project.id, 'Apple')
    const pear = await addClass(project.id, 'Pear')
    await expect(renameClass(pear.id, 'APPLE')).rejects.toThrow(/already/i)
  })

  it('allows renaming a class to its own name with different casing', async () => {
    const project = await createProject('P', 'owner-a')
    const apple = await addClass(project.id, 'apple')
    await expect(renameClass(apple.id, 'Apple')).resolves.toBeUndefined()
  })

  it('deleteClass cascades to its samples only', async () => {
    const project = await createProject('P', 'owner-a')
    const doomed = await addClass(project.id, 'Doomed')
    const kept = await addClass(project.id, 'Kept')
    await addSample({
      projectId: project.id,
      classId: doomed.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })
    const survivor = await addSample({
      projectId: project.id,
      classId: kept.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })

    await deleteClass(doomed.id)
    expect(await db.samples.where('classId').equals(doomed.id).count()).toBe(0)
    expect(await db.samples.get(survivor.id)).toBeDefined()
  })
})

describe('samples', () => {
  it('D3: refuses a class that does not belong to the given project', async () => {
    const a = await createProject('A', 'owner-a')
    const b = await createProject('B', 'owner-a')
    const foreign = await addClass(b.id, 'Apple')

    await expect(
      addSample({
        projectId: a.id,
        classId: foreign.id,
        image: blob(),
        embedding: embedding(),
        embeddingAlpha: ALPHA,
        source: 'camera',
      }),
    ).rejects.toThrow()
  })

  it('D4: stores the pooled embedding tagged with the alpha that produced it', async () => {
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'Apple')
    const sample = await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(512, 0.25),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })

    const stored = await db.samples.get(sample.id)
    expect(stored?.embeddingAlpha).toBe(ALPHA)
    expect(stored?.embedding?.length).toBe(512)
  })

  it('D4: refuses a sample whose embedding was produced by a different backbone', async () => {
    // Silently mixing embeddings from two alphas inside one training run produces a model
    // that trains and then predicts nonsense, with nothing on screen to explain it.
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'Apple')
    await expect(
      addSample({
        projectId: project.id,
        classId: klass.id,
        image: blob(),
        embedding: embedding(256),
        embeddingAlpha: 0.25,
        source: 'camera',
      }),
    ).rejects.toThrow(/backbone|alpha/i)
  })

  it('D4: changing the project alpha marks existing embeddings stale rather than deleting them', async () => {
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'Apple')
    const sample = await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(512),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })

    await markEmbeddingsStale(project.id, 0.25)

    const stale = await listStaleEmbeddingSamples(project.id)
    expect(stale.map((s) => s.id)).toEqual([sample.id])
    // The image blob is NOT derived data and must survive (migration rules).
    expect((await db.samples.get(sample.id))?.image).toBeInstanceOf(Blob)
    expect((await db.projects.get(project.id))?.backboneAlpha).toBe(0.25)
  })

  it('counts samples per class', async () => {
    const project = await createProject('P', 'owner-a')
    const a = await addClass(project.id, 'A')
    const b = await addClass(project.id, 'B')
    for (let i = 0; i < 3; i++) {
      await addSample({
        projectId: project.id,
        classId: a.id,
        image: blob(),
        embedding: embedding(),
        embeddingAlpha: ALPHA,
        source: 'camera',
      })
    }
    await addSample({
      projectId: project.id,
      classId: b.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'upload',
    })

    expect(await countSamplesByClass(project.id)).toEqual({ [a.id]: 3, [b.id]: 1 })
  })

  it('deletes a single sample without touching its siblings (FR-004)', async () => {
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'A')
    const doomed = await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })
    const kept = await addSample({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera',
    })

    await deleteSample(doomed.id)
    expect(await db.samples.get(doomed.id)).toBeUndefined()
    expect(await db.samples.get(kept.id)).toBeDefined()
    expect((await listSamples(project.id, klass.id)).map((s) => s.id)).toEqual([kept.id])
  })
})

describe('D7: a quota error mid-burst', () => {
  it('stops the burst, keeps every sample already written, and reports the true count', async () => {
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'A')

    const inputs = Array.from({ length: 5 }, () => ({
      projectId: project.id,
      classId: klass.id,
      image: blob(),
      embedding: embedding(),
      embeddingAlpha: ALPHA,
      source: 'camera' as const,
    }))

    // Fail on the fourth write, the way a real quota error arrives: part-way through,
    // with no warning, after three samples are already safely on disk.
    let writes = 0
    const originalAdd = db.samples.add.bind(db.samples)
    vi.spyOn(db.samples, 'add').mockImplementation((async (record: never) => {
      writes++
      if (writes === 4) {
        const error = new Error('The quota has been exceeded.')
        error.name = 'QuotaExceededError'
        throw error
      }
      return originalAdd(record)
    }) as typeof db.samples.add)

    const result = await addSampleBurst(inputs)

    expect(result.saved).toBe(3)
    expect(result.stoppedByQuota).toBe(true)
    // The count reported to the learner must match what is actually stored, or she deletes
    // the wrong thing trying to recover.
    expect(await db.samples.where('projectId').equals(project.id).count()).toBe(3)
    expect(result.saved).toBe(await db.samples.where('projectId').equals(project.id).count())
  })

  it('reports every sample saved when nothing goes wrong', async () => {
    const project = await createProject('P', 'owner-a')
    const klass = await addClass(project.id, 'A')
    const result = await addSampleBurst(
      Array.from({ length: 4 }, () => ({
        projectId: project.id,
        classId: klass.id,
        image: blob(),
        embedding: embedding(),
        embeddingAlpha: ALPHA,
        source: 'camera' as const,
      })),
    )
    expect(result).toMatchObject({ saved: 4, stoppedByQuota: false })
  })
})

describe('models', () => {
  it('D5: listStaleTrainingModels returns records left mid-training', async () => {
    const project = await createProject('P', 'owner-a')
    await saveModel({ runId: 'interrupted', projectId: project.id, artifactKey: 'a', classOrder: [] })
    await saveModel({ runId: 'finished', projectId: project.id, artifactKey: 'b', classOrder: [] })
    await markModelReady('finished')

    const stale = await listStaleTrainingModels()
    expect(stale.map((m) => m.runId)).toEqual(['interrupted'])
  })

  it('D5: a record left in `training` is refused for inference (FR-050)', async () => {
    const project = await createProject('P', 'owner-a')
    await saveModel({ runId: 'interrupted', projectId: project.id, artifactKey: 'a', classOrder: [] })
    // `loadModelRecord` is the gate: an unfinished model must never reach the predictor,
    // because it would give a learner confident predictions from a half-trained network.
    await expect(loadModelRecord('interrupted')).resolves.toBeUndefined()
    await markModelReady('interrupted')
    await expect(loadModelRecord('interrupted')).resolves.toMatchObject({ status: 'ready' })
  })

  it('marks a model failed', async () => {
    const project = await createProject('P', 'owner-a')
    await saveModel({ runId: 'r', projectId: project.id, artifactKey: 'a', classOrder: [] })
    await markModelFailed('r')
    expect((await db.models.get('r'))?.status).toBe('failed')
    await expect(loadModelRecord('r')).resolves.toBeUndefined()
  })

  it('keeps classOrder, which maps output index to class', async () => {
    const project = await createProject('P', 'owner-a')
    const a = await addClass(project.id, 'A')
    const b = await addClass(project.id, 'B')
    await saveModel({ runId: 'r', projectId: project.id, artifactKey: 'a', classOrder: [b.id, a.id] })
    await markModelReady('r')
    // Without this a saved model's output vector cannot be attributed to classes after a
    // reorder or rename (data-model.md).
    expect((await loadModelRecord('r'))?.classOrder).toEqual([b.id, a.id])
  })
})

describe('explanations', () => {
  const base = {
    runId: 'run-1',
    frameHash: 'frame-abc',
    classId: 'class-1',
    map: new Float32Array(144).fill(0.5),
    width: 12,
    height: 12,
  }

  it('caches and finds a map by its full key', async () => {
    await cacheExplanation({ ...base, method: 'occlusion', params: { gridSize: 12 } })
    const found = await findExplanation({
      runId: base.runId,
      frameHash: base.frameHash,
      classId: base.classId,
      method: 'occlusion',
      params: { gridSize: 12 },
    })
    expect(found?.width).toBe(12)
    expect(found?.map.length).toBe(144)
  })

  it('D8: a different grid size is a MISS, not a hit', async () => {
    // The single most damaging cache bug available here: serving a 12×12 map for an 8×8
    // request renders a heat map that is subtly wrong everywhere and looks fine.
    await cacheExplanation({ ...base, method: 'occlusion', params: { gridSize: 12 } })
    const found = await findExplanation({
      runId: base.runId,
      frameHash: base.frameHash,
      classId: base.classId,
      method: 'occlusion',
      params: { gridSize: 8 },
    })
    expect(found).toBeUndefined()
  })

  it('D8: a different target layer is a miss', async () => {
    await cacheExplanation({
      ...base,
      method: 'gradcam',
      width: 7,
      height: 7,
      map: new Float32Array(49),
      params: { targetLayer: 'conv_pw_13_relu' },
    })
    await expect(
      findExplanation({
        runId: base.runId,
        frameHash: base.frameHash,
        classId: base.classId,
        method: 'gradcam',
        params: { targetLayer: 'conv_pw_11_relu' },
      }),
    ).resolves.toBeUndefined()
  })

  it('D8: a different class is a miss (FR-016)', async () => {
    await cacheExplanation({ ...base, method: 'occlusion', params: { gridSize: 12 } })
    await expect(
      findExplanation({
        runId: base.runId,
        frameHash: base.frameHash,
        classId: 'class-2',
        method: 'occlusion',
        params: { gridSize: 12 },
      }),
    ).resolves.toBeUndefined()
  })

  it('stores each method at its own native resolution', async () => {
    // data-model.md is explicit: a single "7 or 14" rule would corrupt every occlusion map.
    await cacheExplanation({
      ...base,
      method: 'gradcam',
      width: 7,
      height: 7,
      map: new Float32Array(49),
      params: { targetLayer: 'conv_pw_13_relu' },
    })
    await cacheExplanation({ ...base, method: 'occlusion', params: { gridSize: 12 } })

    const gradcam = await findExplanation({
      runId: base.runId,
      frameHash: base.frameHash,
      classId: base.classId,
      method: 'gradcam',
      params: { targetLayer: 'conv_pw_13_relu' },
    })
    const occlusion = await findExplanation({
      runId: base.runId,
      frameHash: base.frameHash,
      classId: base.classId,
      method: 'occlusion',
      params: { gridSize: 12 },
    })

    expect(gradcam?.width).toBe(7)
    expect(occlusion?.width).toBe(12)
  })

  it('refuses a map whose length disagrees with its dimensions', async () => {
    await expect(
      cacheExplanation({ ...base, method: 'occlusion', map: new Float32Array(100), params: {} }),
    ).rejects.toThrow()
  })

  it('prunes the oldest cached maps for a run, keeping the newest N', async () => {
    for (let i = 0; i < 6; i++) {
      await cacheExplanation({
        ...base,
        frameHash: `frame-${String(i)}`,
        method: 'occlusion',
        params: { gridSize: 12 },
      })
    }
    await pruneExplanations(base.runId, 2)
    expect(await db.explanations.where('runId').equals(base.runId).count()).toBe(2)
  })
})

describe('D6: storage budget', () => {
  it('reports usage and the two thresholds', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ usage: 850, quota: 1000 }) },
    })

    const estimate = await estimateStorage()
    expect(estimate.known).toBe(true)
    expect(estimate.ratio).toBeCloseTo(0.85, 5)
    expect(estimate.shouldWarn).toBe(true)
    expect(estimate.shouldRefuse).toBe(false)
  })

  it('refuses at 95%', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ usage: 960, quota: 1000 }) },
    })
    const estimate = await estimateStorage()
    expect(estimate.shouldRefuse).toBe(true)
  })

  it('does not warn below 80%', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ usage: 500, quota: 1000 }) },
    })
    const estimate = await estimateStorage()
    expect(estimate.shouldWarn).toBe(false)
    expect(estimate.shouldRefuse).toBe(false)
  })

  it('reports `unknown` rather than pretending to know when the API is absent', async () => {
    vi.stubGlobal('navigator', {})
    const estimate = await estimateStorage()
    expect(estimate.known).toBe(false)
    // Refusing captures on a guess would block a learner on a device with plenty of room.
    expect(estimate.shouldRefuse).toBe(false)
    expect(estimate.shouldWarn).toBe(false)
  })

  it('reports `unknown` when estimate() rejects', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.reject(new Error('denied')) },
    })
    await expect(estimateStorage()).resolves.toMatchObject({ known: false })
  })

  it('holds the documented thresholds', () => {
    expect(STORAGE_WARN_RATIO).toBe(0.8)
    expect(STORAGE_REFUSE_RATIO).toBe(0.95)
  })

  it('requestPersistence returns false rather than throwing where unsupported', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestPersistence()).resolves.toBe(false)
  })

  it('requestPersistence asks the browser to keep the data', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('navigator', { storage: { persist } })
    await expect(requestPersistence()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })
})

describe('quota errors are recognisable to callers', () => {
  it('exposes a StorageError carrying how many samples survived', () => {
    const error = new StorageError('QUOTA_EXCEEDED', 'no room', { saved: 3 })
    expect(error.code).toBe('QUOTA_EXCEEDED')
    expect(error.saved).toBe(3)
  })
})
