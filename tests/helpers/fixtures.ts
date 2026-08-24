import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPng } from './png.ts'
import type { ImageSource } from '@/ml/types'

const DIR = join(dirname(), '..', 'fixtures')

function dirname(): string {
  return join(fileURLToPath(import.meta.url), '..')
}

/** The three fixture classes, in a fixed order so class indices are stable across runs. */
export const FIXTURE_CLASSES = ['stripes-h', 'stripes-v', 'circle'] as const
export type FixtureClass = (typeof FIXTURE_CLASSES)[number]

export const SAMPLES_PER_CLASS = 8

export function fixturePath(className: FixtureClass, index: number): string {
  return join(DIR, `class-${className}-${String(index)}.png`)
}

export function loadFixture(className: FixtureClass, index: number): ImageSource {
  return loadPng(fixturePath(className, index))
}

/**
 * Loads every fixture as a flat list plus its label, which is the shape the trainer
 * wants. Order is deterministic: all of class 0, then class 1, then class 2.
 */
export function loadAllFixtures(perClass = SAMPLES_PER_CLASS): {
  images: ImageSource[]
  labels: Uint8Array
} {
  const images: ImageSource[] = []
  const labels: number[] = []
  FIXTURE_CLASSES.forEach((className, classIndex) => {
    for (let i = 0; i < perClass; i++) {
      images.push(loadFixture(className, i))
      labels.push(classIndex)
    }
  })
  return { images, labels: new Uint8Array(labels) }
}

/** A tiny synthetic ImageSource, for tests that need a shape rather than a picture. */
export function solidImage(width: number, height: number, grey: number): ImageSource {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = grey
    data[i * 4 + 1] = grey
    data[i * 4 + 2] = grey
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}
