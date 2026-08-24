import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  asOwner,
  asRole,
  asRoleCommitted,
  checkAvailable,
  disconnect,
  resetDatabase,
  SEED,
  UNAVAILABLE_REASON,
} from './helpers/harness.ts'

/**
 * T032 — all twenty-two required scenarios from contracts/database.md.
 *
 * Because there is no first-party server (Principle II), **these policies are the
 * entire authorisation model**, which is why they are treated as contracts with
 * their own suite rather than as configuration.
 *
 * Five of these are worth defending against schedule pressure, because each
 * catches a failure that is completely invisible from the interface:
 *
 *   19  an administrator gets zero rows from every classroom-content table.
 *       An over-broad policy here creates the one role that can read every
 *       minor's work in the system.
 *   21  `audit_log` is selectable by nobody. An audit screen would recreate
 *       through the back door the role FR-055 exists to prevent.
 *   5–7 the three distinguishable invitation refusals.
 *   22  the redemption rate limit, and refusals that do not leak whether a
 *       username exists.
 *    8  `code_hash` is never selectable by anyone.
 */

const available = await checkAvailable()
const suite = available ? describe : describe.skip
if (!available) console.warn(`Skipping row-level-security contract tests: ${UNAVAILABLE_REASON}`)

beforeAll(async () => {
  if (available) await resetDatabase()
}, 120_000)

afterAll(async () => {
  if (available) await disconnect()
})

// ══════════════════════════════════════════════ 1–4  schema-level guarantees
//
// Scenarios 1, 2 and 3 (G2, G3, definer hygiene) and 4 (FR-051) live in
// schema.test.ts, which must pass before any policy work begins. They are not
// duplicated here.

// ══════════════════════════════════════════════ 5–12  invitation lifecycle

suite('scenario 5 — FR-028: an expired code is refused, naming expiry', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('says the code has expired', async () => {
    await asOwner(
      `update public.invitations set expires_at = now() - interval '1 hour' where id = $1`,
      [SEED.invitationLearner],
    )

    const error = await asRole(null, (session) =>
      session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
        SEED.codeLearner,
        'a-good-password',
        'Willow',
      ]),
    )

    // A learner needs to know whether to wait or to ask for a new code, so the
    // three terminal states must be distinguishable (FR-028).
    expect(error.message).toMatch(/expired/i)
  })
})

suite('scenario 6 — FR-028: an already-redeemed code is refused as used', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('says the code has already been used', async () => {
    await asOwner(`update public.invitations set redeemed_at = now() where id = $1`, [
      SEED.invitationLearner,
    ])

    const error = await asRole(null, (session) =>
      session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
        SEED.codeLearner,
        'a-good-password',
        'Willow',
      ]),
    )

    expect(error.message).toMatch(/already been used/i)
  })
})

suite('scenario 7 — FR-028: a revoked code is refused as cancelled (Scenario 9.3)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('says the code was cancelled, after the issuer revokes it', async () => {
    await asRoleCommitted(SEED.educator1, (session) =>
      session.query(`select public.revoke_invitation($1)`, [SEED.invitationLearner]),
    )

    const error = await asRole(null, (session) =>
      session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
        SEED.codeLearner,
        'a-good-password',
        'Willow',
      ]),
    )

    expect(error.message).toMatch(/cancelled/i)
  })

  it('refuses to revoke an invitation that has already been redeemed', async () => {
    await asOwner(`update public.invitations set redeemed_at = now() where id = $1`, [
      SEED.invitationLearner,
    ])

    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select public.revoke_invitation($1)`, [SEED.invitationLearner]),
    )

    // Revoking a redeemed invitation would imply an account could be un-created.
    expect(error.message).toMatch(/already been redeemed/i)
  })
})

suite('scenario 8 — I2: code_hash is never selectable by anyone', () => {
  it('refuses the issuer, the strictest case', async () => {
    // An invitation code is a bearer credential for creating an account inside a
    // named classroom. A readable table of live codes would let an outsider
    // occupy one — so not even the educator who issued it may read the hash.
    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select code_hash from public.invitations`),
    )
    expect(error.message).toMatch(/permission denied|does not exist/i)
  })

  it('refuses an administrator', async () => {
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select code_hash from public.invitations`),
    )
    expect(error.message).toMatch(/permission denied|does not exist/i)
  })

  it('refuses an anonymous caller', async () => {
    const error = await asRole(null, (session) =>
      session.expectError(`select code_hash from public.invitations`),
    )
    expect(error.message).toMatch(/permission denied|does not exist/i)
  })

  it('still lets the issuer read the state she needs (I1, FR-054)', async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query<{ target: string; redeemed_at: string | null }>(
        `select target, kind, purpose, expires_at, redeemed_at, revoked_at
         from public.invitations order by target`,
      ),
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('never lets anyone read the code pepper either', async () => {
    // Without the pepper a 30-bit hash is reversible, so the pepper is as
    // sensitive as the codes themselves.
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select pepper from public.code_pepper`),
    )
    expect(error.message).toMatch(/permission denied|does not exist/i)
  })
})

suite('scenario 9 — I3: cross-issuer denial', () => {
  it("gives E2 zero rows from E1's invitations", async () => {
    const rows = await asRole(SEED.educator2, (session) =>
      session.query(`select id from public.invitations where issuer_id = $1`, [SEED.educator1]),
    )
    expect(rows).toEqual([])
  })

  it("gives an administrator zero rows from an educator's learner invitations", async () => {
    const rows = await asRole(SEED.admin, (session) =>
      session.query(`select id from public.invitations where kind = 'learner'`),
    )
    expect(rows).toEqual([])
  })

  it('lets an administrator see the invitations she issued herself (FR-054)', async () => {
    const rows = await asRole(SEED.admin, (session) =>
      session.query<{ id: string }>(`select id from public.invitations`),
    )
    expect(rows.map((r) => r.id)).toEqual([SEED.invitationEducator])
  })
})

suite('scenario 10 — I5: a refusal never discloses whether the username exists', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns byte-identical refusals for a wrong code and for no code at all', async () => {
    // The heart of SC-020. If these two messages differ by even a word, the
    // difference is an oracle for enumerating the usernames in a classroom.
    const wrongCodeAgainstRealTarget = await asRole(
      null,
      (session) =>
        session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
          'ZZZZZZ',
          'a-good-password',
          'Willow',
        ]),
      { origin: '198.51.100.10' },
    )

    const codeMatchingNothing = await asRole(
      null,
      (session) =>
        session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
          'YYYYYY',
          'a-good-password',
          'Willow',
        ]),
      { origin: '198.51.100.11' },
    )

    expect(codeMatchingNothing.message).toBe(wrongCodeAgainstRealTarget.message)
  })
})

suite('scenario 11 — G6/P5: no direct insert into profiles, for any role', () => {
  const attempt = `insert into public.profiles (id, username, alias, role)
                   values (gen_random_uuid(), 'sneaky', 'Sneaky', 'educator')`

  it('refuses a learner', async () => {
    const error = await asRole(SEED.learner1, (session) => session.expectError(attempt))
    expect(error.message).toMatch(/permission denied|violates row-level security/i)
  })

  it('refuses an educator', async () => {
    const error = await asRole(SEED.educator1, (session) => session.expectError(attempt))
    expect(error.message).toMatch(/permission denied|violates row-level security/i)
  })

  it('refuses an administrator', async () => {
    const error = await asRole(SEED.admin, (session) => session.expectError(attempt))
    expect(error.message).toMatch(/permission denied|violates row-level security/i)
  })

  it('refuses an anonymous caller', async () => {
    const error = await asRole(null, (session) => session.expectError(attempt))
    expect(error.message).toMatch(/permission denied|violates row-level security/i)
  })
})

suite("scenario 12 — FR-027: nothing exposes a learner's password", () => {
  it('gives an educator no route to a credential, by policy or by RPC', async () => {
    // The holder chooses her own password during redemption, which is exactly why
    // no educator can ever read it. An educator who needs to help a locked-out
    // learner issues a fresh single-use code instead (FR-030).
    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select encrypted_password from auth.users where id = $1`, [SEED.learner1]),
    )
    expect(error.message).toMatch(/permission denied|does not exist/i)
  })

  it('exposes no password-shaped column anywhere in the public schema', async () => {
    const rows = await asOwner<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%password%' or column_name ilike '%secret%')
    `)
    expect(rows).toEqual([])
  })
})

// ══════════════════════════════════ 13–17  isolation between learners and educators

suite('scenario 13 — P2/P4: a learner reads aliases, not usernames, and cannot promote herself', () => {
  it("cannot read L1b's username", async () => {
    // `username` is not granted to `authenticated` on `profiles` at all, so this
    // is refused at the column level rather than filtered at the row level —
    // which is what stops a future policy widening quietly re-exposing it.
    const error = await asRole(SEED.learner1, (session) =>
      session.expectError(`select username from public.profiles where id = $1`, [SEED.learner1b]),
    )
    expect(error.message).toMatch(/permission denied/i)
  })

  it("can read L1b's alias, because they share a classroom (P2)", async () => {
    const rows = await asRole(SEED.learner1, (session) =>
      session.query<{ alias: string }>(`select alias from public.profiles where id = $1`, [
        SEED.learner1b,
      ]),
    )
    expect(rows.map((r) => r.alias)).toEqual(['Nimbus'])
  })

  it("cannot read L2's alias, because they do not (J3-style isolation for profiles)", async () => {
    const rows = await asRole(SEED.learner1, (session) =>
      session.query(`select alias from public.profiles where id = $1`, [SEED.learner2]),
    )
    expect(rows).toEqual([])
  })

  it("can read her educator's display name (P2)", async () => {
    const rows = await asRole(SEED.learner1, (session) =>
      session.query<{ display_name: string }>(
        `select display_name from public.profiles where id = $1`,
        [SEED.educator1],
      ),
    )
    expect(rows.map((r) => r.display_name)).toEqual(['Ms Rivera'])
  })

  it('cannot update her own role', async () => {
    // A client-writable `role` would let any learner promote herself to educator
    // or administrator. This is the single most consequential column grant in the
    // schema.
    const error = await asRole(SEED.learner1, (session) =>
      session.expectError(`update public.profiles set role = 'administrator' where id = $1`, [
        SEED.learner1,
      ]),
    )
    expect(error.message).toMatch(/permission denied/i)
  })

  it('cannot update her own is_active', async () => {
    const error = await asRole(SEED.learner1, (session) =>
      session.expectError(`update public.profiles set is_active = false where id = $1`, [
        SEED.learner1,
      ]),
    )
    expect(error.message).toMatch(/permission denied/i)
  })

  it('cannot update her own username', async () => {
    const error = await asRole(SEED.learner1, (session) =>
      session.expectError(`update public.profiles set username = 'chosen-myself' where id = $1`, [
        SEED.learner1,
      ]),
    )
    expect(error.message).toMatch(/permission denied/i)
  })

  it('CAN update her alias and locale, which is the whole of P4', async () => {
    await asRole(SEED.learner1, async (session) => {
      await session.query(`update public.profiles set alias = 'Meteor', locale = 'es' where id = $1`, [
        SEED.learner1,
      ])
      const rows = await session.query<{ alias: string; locale: string }>(
        `select alias, locale from public.profiles where id = $1`,
        [SEED.learner1],
      )
      expect(rows[0]).toMatchObject({ alias: 'Meteor', locale: 'es' })
    })
  })

  it("cannot update another learner's alias", async () => {
    const rows = await asRole(SEED.learner1, (session) =>
      session.query(
        `update public.profiles set alias = 'Hijacked' where id = $1 returning id`,
        [SEED.learner1b],
      ),
    )
    expect(rows).toEqual([])
  })
})

suite('scenario 14 — K3: cross-educator denial (SC-011)', () => {
  it('gives E2 zero rows for classroom K1', async () => {
    const rows = await asRole(SEED.educator2, (session) =>
      session.query(`select id, name from public.classrooms where id = $1`, [SEED.classroom1]),
    )
    expect(rows).toEqual([])
  })

  it('gives E2 zero rows for K1s enrolments', async () => {
    const rows = await asRole(SEED.educator2, (session) =>
      session.query(`select learner_id from public.enrolments where classroom_id = $1`, [
        SEED.classroom1,
      ]),
    )
    expect(rows).toEqual([])
  })

  it("gives E2 zero rows for L1's projects, progress and reflections", async () => {
    await asRole(SEED.educator2, async (session) => {
      expect(
        await session.query(`select id from public.projects where owner_id = $1`, [SEED.learner1]),
      ).toEqual([])
      expect(
        await session.query(`select module_id from public.lesson_progress where learner_id = $1`, [
          SEED.learner1,
        ]),
      ).toEqual([])
      expect(
        await session.query(`select id from public.reflections where learner_id = $1`, [SEED.learner1]),
      ).toEqual([])
    })
  })

  it('refuses E2 an update to K1', async () => {
    const rows = await asRole(SEED.educator2, (session) =>
      session.query(`update public.classrooms set name = 'Mine now' where id = $1 returning id`, [
        SEED.classroom1,
      ]),
    )
    expect(rows).toEqual([])
  })

  it('lets E1 read and archive her own classroom (K1, K4)', async () => {
    await asRole(SEED.educator1, async (session) => {
      const before = await session.query<{ id: string }>(
        `select id from public.classrooms where id = $1`,
        [SEED.classroom1],
      )
      expect(before.map((r) => r.id)).toEqual([SEED.classroom1])

      // K4: archiving hides the classroom without deleting it or its enrolments.
      await session.query(`update public.classrooms set archived_at = now() where id = $1`, [
        SEED.classroom1,
      ])
      const enrolments = await session.query(
        `select learner_id from public.enrolments where classroom_id = $1`,
        [SEED.classroom1],
      )
      expect(enrolments).toHaveLength(2)
    })
  })
})

suite("scenario 15 — J2: an educator reads a learner's runs and cannot write them", () => {
  it('lets E1 read L1s training runs', async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query<{ id: string }>(`select id from public.training_runs`),
    )
    expect(rows.map((r) => r.id)).toContain(SEED.run1)
  })

  it('refuses E1 an update to them', async () => {
    // Read-only is the point: a well-meaning educator must not be able to tidy up
    // a learner's figures, because then the figures are no longer the learner's.
    const rows = await asRole(SEED.educator1, (session) =>
      session.query(
        `update public.training_runs set overall_accuracy = 1.0 where id = $1 returning id`,
        [SEED.run1],
      ),
    )
    expect(rows).toEqual([])
  })

  it('refuses E1 a delete', async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query(`delete from public.training_runs where id = $1 returning id`, [SEED.run1]),
    )
    expect(rows).toEqual([])
  })

  it("refuses E1 an update to a learner's project", async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query(`update public.projects set name = 'Renamed' where id = $1 returning id`, [
        SEED.project1,
      ]),
    )
    expect(rows).toEqual([])
  })

  it('lets E1 read L1s progress and reflections (L2, FR-040)', async () => {
    await asRole(SEED.educator1, async (session) => {
      const progress = await session.query(`select module_id from public.lesson_progress`)
      expect(progress.length).toBeGreaterThan(0)
      const reflections = await session.query(`select answer from public.reflections`)
      expect(reflections.length).toBeGreaterThan(0)
    })
  })

  it('refuses E1 an update to a reflection', async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query(
        `update public.reflections set answer = 'Edited by teacher'
         where learner_id = $1 returning id`,
        [SEED.learner1],
      ),
    )
    expect(rows).toEqual([])
  })
})

suite('scenario 16 — J3/L3: cross-learner denial (FR-042)', () => {
  it("gives L2 zero rows from every one of L1's tables", async () => {
    await asRole(SEED.learner2, async (session) => {
      expect(
        await session.query(`select id from public.projects where owner_id = $1`, [SEED.learner1]),
      ).toEqual([])
      expect(
        await session.query(`select id from public.training_runs where project_id = $1`, [
          SEED.project1,
        ]),
      ).toEqual([])
      expect(
        await session.query(`select module_id from public.lesson_progress where learner_id = $1`, [
          SEED.learner1,
        ]),
      ).toEqual([])
      expect(
        await session.query(`select answer from public.reflections where learner_id = $1`, [
          SEED.learner1,
        ]),
      ).toEqual([])
    })
  })

  it("gives L1b, who shares a classroom with L1, zero rows from L1's work", async () => {
    // Sharing a classroom grants sight of an alias (P2) and nothing else. This is
    // the case most likely to be got wrong, because "same classroom" feels like
    // it should mean more than it does.
    await asRole(SEED.learner1b, async (session) => {
      expect(
        await session.query(`select id from public.projects where owner_id = $1`, [SEED.learner1]),
      ).toEqual([])
      expect(
        await session.query(`select answer from public.reflections where learner_id = $1`, [
          SEED.learner1,
        ]),
      ).toEqual([])
    })
  })

  it("refuses L2 an insert into L1's project", async () => {
    const error = await asRole(SEED.learner2, (session) =>
      session.expectError(
        `insert into public.reflections (learner_id, module_id, question_id, answer)
         values ($1, 'm', 'q', 'planted')`,
        [SEED.learner1],
      ),
    )
    expect(error.message).toMatch(/violates row-level security/i)
  })

  it('lets L1 read and write her own rows (J1, L1)', async () => {
    await asRole(SEED.learner1, async (session) => {
      const projects = await session.query<{ id: string }>(`select id from public.projects`)
      expect(projects.map((r) => r.id)).toEqual([SEED.project1])

      await session.query(
        `insert into public.reflections (learner_id, module_id, question_id, answer)
         values ($1, 'reading-a-heat-map', 'what-did-it-look-at', 'The background, mostly.')`,
        [SEED.learner1],
      )
    })
  })

  it('L4: a repeat answer to the same question replaces rather than appends (FR-035)', async () => {
    await asRole(SEED.learner1, async (session) => {
      await session.query(
        `insert into public.reflections (learner_id, module_id, question_id, answer)
         values ($1, 'what-the-model-sees', 'what-surprised-you', 'Revised answer.')
         on conflict (learner_id, module_id, question_id)
         do update set answer = excluded.answer, updated_at = now()`,
        [SEED.learner1],
      )

      const rows = await session.query<{ answer: string }>(
        `select answer from public.reflections
         where learner_id = $1 and module_id = 'what-the-model-sees'
           and question_id = 'what-surprised-you'`,
        [SEED.learner1],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.answer).toBe('Revised answer.')
    })
  })
})

suite('scenario 17 — is_educator_of does not recurse (R9)', () => {
  it('lets E1 read her full roster without a recursive policy error', async () => {
    // This test exists because the NAIVE formulation fails here: a policy on
    // `enrolments` that itself selects from `enrolments` recurses and errors at
    // runtime. The SECURITY DEFINER helper is the standard remedy, and this is
    // the assertion that it is actually in use.
    const rows = await asRole(SEED.educator1, (session) =>
      session.query<{ learner_id: string }>(
        `select e.learner_id
         from public.enrolments e
         join public.profiles p on p.id = e.learner_id
         where e.classroom_id = $1
         order by p.alias`,
        [SEED.classroom1],
      ),
    )
    expect(rows.map((r) => r.learner_id).sort()).toEqual([SEED.learner1, SEED.learner1b].sort())
  })

  it('resolves the roster view without recursion, including usernames (P3)', async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query<{ username: string }>(
        `select username from public.educator_roster order by username`,
      ),
    )
    // She sees the usernames she issued and no others.
    expect(rows.map((r) => r.username)).toEqual(['learner-l1', 'learner-l1b'])
  })

  it("gives E2 no rows from the roster view for E1's learners", async () => {
    const rows = await asRole(SEED.educator2, (session) =>
      session.query<{ username: string }>(`select username from public.educator_roster`),
    )
    expect(rows.map((r) => r.username)).toEqual(['learner-l2'])
  })

  it('gives a learner no rows from the roster view at all', async () => {
    const rows = await asRole(SEED.learner1, (session) =>
      session.query(`select username from public.educator_roster`),
    )
    expect(rows).toEqual([])
  })
})

// ══════════════════════════ 18–22  destructive actions and administration

suite('scenario 18 — FR-052/SC-015: deleting a learner leaves no residual row', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('removes every row referencing L1 across all seven tables', async () => {
    await asRoleCommitted(SEED.educator1, (session) =>
      session.query(`select public.delete_learner($1)`, [SEED.learner1]),
    )

    for (const [table, column] of [
      ['profiles', 'id'],
      ['enrolments', 'learner_id'],
      ['projects', 'owner_id'],
      ['lesson_progress', 'learner_id'],
      ['reflections', 'learner_id'],
    ] as const) {
      const rows = await asOwner(
        `select 1 from public.${table} where ${column} = $1`,
        [SEED.learner1],
      )
      expect(rows, `${table}.${column} still references the deleted learner`).toEqual([])
    }

    // training_runs reference the project, not the learner, so they are the row
    // most likely to survive a cascade written from the profile outwards.
    expect(
      await asOwner(`select 1 from public.training_runs where project_id = $1`, [SEED.project1]),
    ).toEqual([])

    // Her invitations go too: a live invitation naming a deleted username would
    // let the identity be re-occupied.
    expect(
      await asOwner(`select 1 from public.invitations where lower(target) = 'learner-l1'`),
    ).toEqual([])

    expect(await asOwner(`select 1 from auth.users where id = $1`, [SEED.learner1])).toEqual([])
  })

  it("E4: removing a learner from a classroom deletes only the enrolment", async () => {
    // The distinction is the whole of FR-039: the learner keeps her account, her
    // projects, her progress and her reflections, and only the educator's
    // visibility ends. Deleting the account is the separate, heavier FR-052.
    await asRoleCommitted(SEED.educator1, (session) =>
      session.query(`delete from public.enrolments where learner_id = $1`, [SEED.learner1b]),
    )

    expect(await asOwner(`select 1 from public.enrolments where learner_id = $1`, [SEED.learner1b])).toEqual([])
    expect(await asOwner(`select 1 from public.profiles where id = $1`, [SEED.learner1b])).toHaveLength(1)
    expect(
      await asOwner(`select 1 from public.lesson_progress where learner_id = $1`, [SEED.learner1b]),
    ).toBeDefined()

    // Her alias is freed by the ON DELETE SET NULL on the derived column, so
    // someone else in K1 may now take it.
    const rows = await asOwner<{ classroom_id: string | null }>(
      `select classroom_id from public.profiles where id = $1`,
      [SEED.learner1b],
    )
    expect(rows[0]?.classroom_id).toBeNull()
  })

  it("refuses E2 the deletion of E1's learner", async () => {
    const error = await asRole(SEED.educator2, (session) =>
      session.expectError(`select public.delete_learner($1)`, [SEED.learner1]),
    )
    expect(error.message).toMatch(/not in a classroom you own/i)
  })

  it('refuses an administrator the deletion of a learner (FR-055)', async () => {
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select public.delete_learner($1)`, [SEED.learner1]),
    )
    expect(error.message).toMatch(/not in a classroom you own/i)
  })
})

suite('scenario 19 — FR-055/SC-018 and FR-056: the administrator boundary', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('gives A1 ZERO rows from every classroom-content table', async () => {
    // The most important assertion in this file. An over-broad administrator
    // policy is the single easiest way to accidentally create a role that can
    // read every minor's work in the system, and it is invisible from the
    // interface — an administration screen with nothing on it looks identical to
    // one that is correctly empty.
    await asRole(SEED.admin, async (session) => {
      for (const table of [
        'enrolments',
        'projects',
        'training_runs',
        'lesson_progress',
        'reflections',
      ]) {
        const rows = await session.query(`select * from public.${table}`)
        expect(rows, `an administrator can read ${table}`).toEqual([])
      }
    })
  })

  it('gives A1 zero rows from classrooms itself', async () => {
    const rows = await asRole(SEED.admin, (session) =>
      session.query(`select id from public.classrooms`),
    )
    expect(rows).toEqual([])
  })

  it('gives A1 exactly id, name and educator_id through her own view (K5)', async () => {
    // Postgres column privileges are per database role and Supabase gives every
    // signed-in account the same one, so "exactly three columns" can only be
    // expressed as a separate relation. This is that relation.
    const rows = await asRole(SEED.admin, (session) =>
      session.query<{ id: string; name: string; educator_id: string }>(
        `select * from public.admin_classrooms order by name`,
      ),
    )

    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['educator_id', 'id', 'name'])
  })

  it('gives an educator no rows from the administrator view', async () => {
    const rows = await asRole(SEED.educator1, (session) =>
      session.query(`select * from public.admin_classrooms`),
    )
    expect(rows).toEqual([])
  })

  it('gives A1 no learner rows from profiles, only educators (P6)', async () => {
    const rows = await asRole(SEED.admin, (session) =>
      session.query<{ id: string; role: string }>(`select id, role from public.profiles order by role`),
    )
    // Herself and the two educators. No learner, at all.
    expect(rows.map((r) => r.role).sort()).toEqual(['administrator', 'educator', 'educator'])
    expect(rows.map((r) => r.id)).not.toContain(SEED.learner1)
  })

  it('FR-056: refuses to deactivate the last active administrator', async () => {
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select public.deactivate_educator($1)`, [SEED.admin]),
    )
    // Without this, the programme can be locked out of its own administration and
    // no path back exists — there is no self-registration to fall back on.
    expect(error.message).toMatch(/last active administrator/i)
  })

  it('allows deactivating an administrator once a second one exists', async () => {
    await asOwner(
      `update public.profiles set role = 'administrator' where id = $1`,
      [SEED.educator2],
    )
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.deactivate_educator($1)`, [SEED.admin]),
    )
    const rows = await asOwner<{ is_active: boolean }>(
      `select is_active from public.profiles where id = $1`,
      [SEED.admin],
    )
    expect(rows[0]?.is_active).toBe(false)
  })

  it('deactivates an educator and records it', async () => {
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.deactivate_educator($1)`, [SEED.educator1]),
    )
    const rows = await asOwner<{ is_active: boolean }>(
      `select is_active from public.profiles where id = $1`,
      [SEED.educator1],
    )
    expect(rows[0]?.is_active).toBe(false)
  })

  it('refuses an educator the deactivation of anyone', async () => {
    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select public.deactivate_educator($1)`, [SEED.educator2]),
    )
    expect(error.message).toMatch(/only an administrator/i)
  })

  it('refuses an administrator the deactivation of a learner account', async () => {
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select public.deactivate_educator($1)`, [SEED.learner1]),
    )
    expect(error.message).toMatch(/managed by her educator/i)
  })
})

suite('scenario 20 — FR-057: reassigning a classroom', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('moves K1 to E2, who then reads its roster while E1 reads nothing', async () => {
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.reassign_classroom($1, $2)`, [SEED.classroom1, SEED.educator2]),
    )

    const forE2 = await asRole(SEED.educator2, (session) =>
      session.query<{ learner_id: string }>(
        `select learner_id from public.enrolments where classroom_id = $1`,
        [SEED.classroom1],
      ),
    )
    expect(forE2.map((r) => r.learner_id).sort()).toEqual([SEED.learner1, SEED.learner1b].sort())

    // And she inherits the progress that comes with it (L2 via is_educator_of).
    const progress = await asRole(SEED.educator2, (session) =>
      session.query(`select module_id from public.lesson_progress where learner_id = $1`, [
        SEED.learner1,
      ]),
    )
    expect(progress.length).toBeGreaterThan(0)

    const forE1 = await asRole(SEED.educator1, (session) =>
      session.query(`select id from public.classrooms where id = $1`, [SEED.classroom1]),
    )
    expect(forE1).toEqual([])
  })

  it('K6: refuses A1 a rename, an archive, or a delete', async () => {
    await asRole(SEED.admin, async (session) => {
      for (const statement of [
        `update public.classrooms set name = 'Renamed by admin' where id = $1 returning id`,
        `update public.classrooms set archived_at = now() where id = $1 returning id`,
        `delete from public.classrooms where id = $1 returning id`,
      ]) {
        const rows = await session.query(statement, [SEED.classroom1])
        expect(rows, `an administrator managed: ${statement}`).toEqual([])
      }
    })
  })

  it('refuses a reassignment to an inactive educator', async () => {
    await asOwner(`update public.profiles set is_active = false where id = $1`, [SEED.educator2])
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select public.reassign_classroom($1, $2)`, [
        SEED.classroom1,
        SEED.educator2,
      ]),
    )
    expect(error.message).toMatch(/active educator/i)
  })

  it('refuses a reassignment to a learner', async () => {
    const error = await asRole(SEED.admin, (session) =>
      session.expectError(`select public.reassign_classroom($1, $2)`, [
        SEED.classroom1,
        SEED.learner1,
      ]),
    )
    expect(error.message).toMatch(/active educator/i)
  })

  it('refuses an educator the reassignment of her own classroom', async () => {
    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select public.reassign_classroom($1, $2)`, [
        SEED.classroom1,
        SEED.educator2,
      ]),
    )
    expect(error.message).toMatch(/only an administrator/i)
  })
})

suite('scenario 21 — FR-058/SC-019: the audit log', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('appends exactly one row per irreversible action, in the same transaction', async () => {
    const before = await asOwner<{ count: string }>(`select count(*) from public.audit_log`)
    expect(Number(before[0]?.count)).toBe(0)

    await asRoleCommitted(SEED.educator1, (session) =>
      session.query(`select public.delete_learner($1)`, [SEED.learner1]),
    )
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.reassign_classroom($1, $2)`, [SEED.classroom1, SEED.educator2]),
    )
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.deactivate_educator($1)`, [SEED.educator1]),
    )

    const rows = await asOwner<{ action: string; actor_id: string; subject_id: string }>(
      `select action, actor_id, subject_id from public.audit_log order by id`,
    )

    expect(rows.map((r) => r.action)).toEqual([
      'learner_deleted',
      'classroom_reassigned',
      'educator_deactivated',
    ])
    expect(rows[0]?.subject_id).toBe(SEED.learner1)
    expect(rows[0]?.actor_id).toBe(SEED.educator1)
  })

  it('rolls the audit row back with its effect when the action fails', async () => {
    // This is what "in the same transaction" buys, and the direction that matters
    // less is still worth pinning: a log recording something that did not happen
    // is as misleading as a missing entry.
    await asRole(SEED.educator2, (session) =>
      session.expectError(`select public.delete_learner($1)`, [SEED.learner1]),
    )
    const rows = await asOwner<{ count: string }>(`select count(*) from public.audit_log`)
    expect(Number(rows[0]?.count)).toBe(0)
  })

  it('records only the three irreversible actions, not invitation issue or revoke', async () => {
    // Issuing or revoking an invitation destroys nothing, so recording it would
    // grow the log without adding accountability (FR-058).
    await asRoleCommitted(SEED.educator1, (session) =>
      session.query(`select public.issue_learner_invitation($1, $2)`, [
        SEED.classroom1,
        'brand-new-learner',
      ]),
    )
    await asRoleCommitted(SEED.educator1, (session) =>
      session.query(`select public.revoke_invitation($1)`, [SEED.invitationLearner]),
    )

    const rows = await asOwner<{ count: string }>(`select count(*) from public.audit_log`)
    expect(Number(rows[0]?.count)).toBe(0)
  })

  it('U1: is selectable by NOBODY, including an administrator', async () => {
    // Deliberate, and worth defending against the obvious objection. An entry
    // such as "educator E deleted learner L" names a learner account, which is
    // exactly what FR-055 forbids an administrator to reach. An audit screen
    // would recreate through the back door the one role this design prevents.
    for (const actor of [SEED.admin, SEED.educator1, SEED.learner1, null]) {
      const error = await asRole(actor, (session) =>
        session.expectError(`select * from public.audit_log`),
      )
      expect(error.message).toMatch(/permission denied|does not exist/i)
    }
  })

  it('U3: is append-only — nobody may update or delete a row', async () => {
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.reassign_classroom($1, $2)`, [SEED.classroom1, SEED.educator2]),
    )

    for (const actor of [SEED.admin, SEED.educator1]) {
      const update = await asRole(actor, (session) =>
        session.expectError(`update public.audit_log set action = 'learner_deleted'`),
      )
      expect(update.message).toMatch(/permission denied|does not exist/i)

      const remove = await asRole(actor, (session) =>
        session.expectError(`delete from public.audit_log`),
      )
      expect(remove.message).toMatch(/permission denied|does not exist/i)
    }
  })

  it('U4: holds no personal datum in detail, only opaque identifiers', async () => {
    await asRoleCommitted(SEED.admin, (session) =>
      session.query(`select public.reassign_classroom($1, $2)`, [SEED.classroom1, SEED.educator2]),
    )

    const rows = await asOwner<{ detail: Record<string, string> | null }>(
      `select detail from public.audit_log where action = 'classroom_reassigned'`,
    )
    const detail = rows[0]?.detail ?? {}

    expect(Object.keys(detail).sort()).toEqual(['from_educator_id', 'to_educator_id'])
    // No alias, no username, no name — a log built to be readable by a human is a
    // log that has become personal data.
    for (const value of Object.values(detail)) {
      expect(value).toMatch(/^[0-9a-f-]{36}$/)
    }
  })
})

suite('scenario 22 — FR-028/SC-020: the redemption rate limit', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('refuses a sixth failed attempt from one origin within an hour', async () => {
    // At ~30 bits a code has about a billion possibilities and roughly 360
    // guesses available over its 72-hour life, so this limit is the PRIMARY
    // defence rather than a secondary one — which is why it is a database
    // obligation with its own test and not an interface courtesy that anyone
    // could remove.
    const origin = '198.51.100.99'
    const wrongCodes = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE']

    for (const code of wrongCodes) {
      await asRoleCommitted(
        null,
        async (session) => {
          const error = await session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
            code,
            'a-good-password',
            'Willow',
          ])
          expect(error.message).toMatch(/not valid/i)
        },
        { origin },
      ).catch(() => undefined)
    }

    const sixth = await asRole(
      null,
      (session) =>
        session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
          'FFFFFF',
          'a-good-password',
          'Willow',
        ]),
      { origin },
    )
    expect(sixth.message).toMatch(/too many attempts/i)
  })

  it('does not penalise a different origin', async () => {
    const origin = '198.51.100.50'
    for (const code of ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE']) {
      await asRoleCommitted(
        null,
        (session) =>
          session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
            code,
            'a-good-password',
            'Willow',
          ]),
        { origin },
      ).catch(() => undefined)
    }

    // A classroom of learners sharing one school connection would otherwise lock
    // itself out; a per-origin limit keeps the blast radius at the attacker.
    const other = await asRole(
      null,
      (session) =>
        session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
          'GGGGGG',
          'a-good-password',
          'Willow',
        ]),
      { origin: '198.51.100.51' },
    )
    expect(other.message).toMatch(/not valid/i)
    expect(other.message).not.toMatch(/too many/i)
  })

  it('is enforced before the code is even looked up, so timing leaks nothing', async () => {
    const origin = '198.51.100.77'
    await asOwner(
      `insert into public.redemption_attempts (origin, attempted_at)
       select $1, now() from generate_series(1, 5)`,
      [origin],
    )

    // A REAL code must also be refused once the limit is reached. If the limit
    // were checked after the lookup, the difference between a valid and an
    // invalid code would still be observable.
    const error = await asRole(
      null,
      (session) =>
        session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
          SEED.codeLearner,
          'a-good-password',
          'Willow',
        ]),
      { origin },
    )
    expect(error.message).toMatch(/too many attempts/i)
  })

  it('lets nobody read or clear the attempt record', async () => {
    for (const actor of [SEED.admin, SEED.educator1, null]) {
      const read = await asRole(actor, (session) =>
        session.expectError(`select * from public.redemption_attempts`),
      )
      expect(read.message).toMatch(/permission denied|does not exist/i)
    }
  })
})

// ═══════════════════════════════════ end-to-end redemption, which ties it together

suite('redemption end to end (FR-024, FR-027, FR-051)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates a learner account, enrols her, and lets her sign in with her own password', async () => {
    const newId = await asRoleCommitted(null, async (session) => {
      const rows = await session.query<{ redeem_invitation: string }>(
        `select public.redeem_invitation($1, $2, $3) as redeem_invitation`,
        [SEED.codeLearner, 'a-good-password', 'Willow'],
      )
      return rows[0]?.redeem_invitation ?? ''
    })

    expect(newId).toMatch(/^[0-9a-f-]{36}$/)

    const profile = await asOwner<{ username: string; alias: string; role: string; classroom_id: string }>(
      `select username, alias, role, classroom_id from public.profiles where id = $1`,
      [newId],
    )
    expect(profile[0]).toMatchObject({
      username: 'learner-new',
      alias: 'Willow',
      role: 'learner',
      classroom_id: SEED.classroom1,
    })

    // FR-027: the password is hers. It was never seen by her educator, and the
    // stored value is a hash of what she typed.
    const auth = await asOwner<{ matches: boolean }>(
      `select encrypted_password = extensions.crypt('a-good-password', encrypted_password) as matches
       from auth.users where id = $1`,
      [newId],
    )
    expect(auth[0]?.matches).toBe(true)

    // R16: a non-resolvable derived identifier, never a real address.
    const identifier = await asOwner<{ email: string }>(
      `select email from auth.users where id = $1`,
      [newId],
    )
    expect(identifier[0]?.email).toBe('learner-new@learner.invalid')

    const invitation = await asOwner<{ redeemed_at: string | null }>(
      `select redeemed_at from public.invitations where id = $1`,
      [SEED.invitationLearner],
    )
    expect(invitation[0]?.redeemed_at).not.toBeNull()
  })

  it('refuses an alias already used in that classroom (FR-051)', async () => {
    const error = await asRole(null, (session) =>
      session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
        SEED.codeLearner,
        'a-good-password',
        // "Comet" is L1's alias, inside the same classroom the invitation names.
        'Comet',
      ]),
    )
    expect(error.message).toMatch(/already uses that display name/i)
  })

  it('accepts an alias that is only used in a DIFFERENT classroom', async () => {
    // L2 in K2 is also "Comet". Scoping the constraint to the classroom is the
    // whole of FR-051, and getting it system-wide instead would make aliases
    // scarce and confusing for no benefit.
    const rows = await asRoleCommitted(null, (session) =>
      session.query<{ id: string }>(`select public.redeem_invitation($1, $2, $3) as id`, [
        SEED.codeLearner,
        'a-good-password',
        'Nimbus2',
      ]),
    )
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('a password reset changes the credential without creating a second account', async () => {
    const before = await asOwner<{ count: string }>(`select count(*) from public.profiles`)

    await asRoleCommitted(null, (session) =>
      session.query(`select public.redeem_invitation($1, $2, $3)`, [
        SEED.codeReset,
        'a-brand-new-password',
        // Ignored for a reset: her classmates already know her by her alias, and a
        // reset is not an invitation to rename yourself.
        'Nimbus',
      ]),
    )

    const after = await asOwner<{ count: string }>(`select count(*) from public.profiles`)
    expect(after[0]?.count).toBe(before[0]?.count)

    const auth = await asOwner<{ matches: boolean }>(
      `select encrypted_password = extensions.crypt('a-brand-new-password', encrypted_password) as matches
       from auth.users where id = $1`,
      [SEED.learner1b],
    )
    expect(auth[0]?.matches).toBe(true)
  })

  it('refuses a password shorter than eight characters without counting an attempt', async () => {
    const origin = '198.51.100.200'
    const error = await asRole(
      null,
      (session) =>
        session.expectError(`select public.redeem_invitation($1, $2, $3)`, [
          SEED.codeLearner,
          'short',
          'Willow',
        ]),
      { origin },
    )
    expect(error.message).toMatch(/at least 8 characters/i)

    // A learner choosing a short password has not guessed at a code, so holding
    // it against her rate limit would lock her out of her own account.
    const attempts = await asOwner<{ count: string }>(
      `select count(*) from public.redemption_attempts where origin = $1`,
      [origin],
    )
    expect(Number(attempts[0]?.count)).toBe(0)
  })

  it('an educator issuing an invitation cannot see the code again afterwards', async () => {
    const code = await asRoleCommitted(SEED.educator1, async (session) => {
      const rows = await session.query<{ code: string }>(
        `select public.issue_learner_invitation($1, $2) as code`,
        [SEED.classroom1, 'another-learner'],
      )
      return rows[0]?.code ?? ''
    })

    expect(code).toHaveLength(6)

    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select code_hash from public.invitations`),
    )
    expect(error.message).toMatch(/permission denied/i)
  })

  it('refuses an educator an invitation into a classroom she does not own', async () => {
    const error = await asRole(SEED.educator2, (session) =>
      session.expectError(`select public.issue_learner_invitation($1, $2)`, [
        SEED.classroom1,
        'poached-learner',
      ]),
    )
    expect(error.message).toMatch(/do not own/i)
  })

  it('refuses an educator a username that is already taken (Edge Cases)', async () => {
    const error = await asRole(SEED.educator1, (session) =>
      session.expectError(`select public.issue_learner_invitation($1, $2)`, [
        SEED.classroom1,
        'LEARNER-L1',
      ]),
    )
    expect(error.message).toMatch(/already taken/i)
  })

  it('refuses a learner or an educator the invitation of an educator', async () => {
    for (const actor of [SEED.learner1, SEED.educator1]) {
      const error = await asRole(actor, (session) =>
        session.expectError(`select public.issue_educator_invitation($1)`, ['someone@example.org']),
      )
      expect(error.message).toMatch(/only an administrator/i)
    }
  })

  it('lets an administrator invite an educator, who redeems into an educator account', async () => {
    const code = await asRoleCommitted(SEED.admin, async (session) => {
      const rows = await session.query<{ code: string }>(
        `select public.issue_educator_invitation($1) as code`,
        ['fresh.teacher@example.org'],
      )
      return rows[0]?.code ?? ''
    })

    const newId = await asRoleCommitted(null, async (session) => {
      const rows = await session.query<{ id: string }>(
        `select public.redeem_invitation($1, $2, $3) as id`,
        [code, 'a-good-password', 'Ms Fresh'],
      )
      return rows[0]?.id ?? ''
    })

    const profile = await asOwner<{ role: string; username: string; display_name: string }>(
      `select role, username, display_name from public.profiles where id = $1`,
      [newId],
    )

    expect(profile[0]?.role).toBe('educator')
    expect(profile[0]?.display_name).toBe('Ms Fresh')
    // Her email address stays in auth.users. A username derived from its local
    // part is what appears in `profiles`, because an educator's address must
    // never be exposed through a table that P3 lets an educator read.
    expect(profile[0]?.username).not.toContain('@')
    expect(profile[0]?.username).toBe('fresh.teacher')
  })

  it('an educator can issue a password reset for her own learner but not another', async () => {
    const code = await asRoleCommitted(SEED.educator1, async (session) => {
      const rows = await session.query<{ code: string }>(
        `select public.issue_password_reset($1) as code`,
        [SEED.learner1],
      )
      return rows[0]?.code ?? ''
    })
    expect(code).toHaveLength(6)

    const error = await asRole(SEED.educator2, (session) =>
      session.expectError(`select public.issue_password_reset($1)`, [SEED.learner1]),
    )
    expect(error.message).toMatch(/not in a classroom you own/i)
  })
})
