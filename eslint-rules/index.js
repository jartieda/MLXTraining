/**
 * Local ESLint rules enforcing two constitutional obligations that no off-the-shelf
 * plugin covers. Both exist because the alternative is a convention people forget.
 *
 *   Principle V  -> no-raw-hex-or-font-family
 *   Principle VI -> ml-core-import-boundary
 */

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const CSS_COLOUR_FN = /\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/

/**
 * Principle V: all colour and typography comes from the Technovation tokens declared
 * once in src/styles/tokens.css. A component that hard-codes #7B2CBF looks fine in
 * isolation and quietly destroys the design system.
 *
 * Heat maps are deliberately exempt: Principle V exempts them so they can use a
 * perceptually uniform ramp, so src/ml/explain/colormap.ts is allowed raw values.
 */
const noRawHexOrFontFamily = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid raw hex colours and font families outside the token layer' },
    schema: [],
    messages: {
      rawHex:
        'Raw colour value "{{value}}" is not allowed here. Use a Technovation token from src/styles/tokens.css (Principle V).',
      fontFamily:
        'Declaring a font family here is not allowed. Use the Tailwind theme, which maps the tokens (Principle V).',
    },
  },
  create(context) {
    const check = (node, raw) => {
      if (typeof raw !== 'string') return
      const value = raw.trim()
      if (HEX_COLOUR.test(value) || CSS_COLOUR_FN.test(value)) {
        context.report({ node, messageId: 'rawHex', data: { value } })
        return
      }
      if (/font-family\s*:/i.test(value)) {
        context.report({ node, messageId: 'fontFamily' })
      }
    }

    return {
      Literal(node) {
        check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.raw)
      },
      // JSX style={{ fontFamily: '...' }}
      Property(node) {
        const key = node.key
        const name = key.type === 'Identifier' ? key.name : key.value
        if (name === 'fontFamily' || name === 'font') {
          context.report({ node, messageId: 'fontFamily' })
        }
      },
    }
  },
}

/**
 * Principle VI: src/ml/ must be importable and testable without a DOM, a camera, or a
 * network. Enforced here rather than by convention, because the failure it prevents is
 * silent - a subtly wrong gradient still renders a plausible heat map, and the only way
 * to catch that is a deterministic node-environment test, which an accidental
 * `document` reference makes impossible to run.
 */
const FORBIDDEN_IMPORT_PREFIXES = ['@/features', '@/components', '@/lib', '../features', '../components', '../lib']
const FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'HTMLCanvasElement',
  'ImageData',
  'createImageBitmap',
]

const mlCoreImportBoundary = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep src/ml/ free of DOM, network and feature-layer dependencies' },
    schema: [],
    messages: {
      forbiddenImport:
        'src/ml/ must not import from "{{source}}". The ML core is tested without a DOM or a network (Principle VI); convert data at the feature boundary instead.',
      forbiddenGlobal:
        '"{{name}}" is a DOM or network global and is not available where src/ml/ is tested. Accept an ImageSource structure instead (Principle VI, contracts/ml-core.md).',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== 'string') return
        if (FORBIDDEN_IMPORT_PREFIXES.some((p) => source === p || source.startsWith(`${p}/`))) {
          context.report({ node, messageId: 'forbiddenImport', data: { source } })
        }
      },
      Identifier(node) {
        if (!FORBIDDEN_GLOBALS.includes(node.name)) return
        // Only flag genuine global reads, not property access or local declarations.
        const scope = context.sourceCode.getScope(node)
        const resolved = scope.references.find((ref) => ref.identifier === node)?.resolved
        if (resolved && resolved.defs.length > 0) return
        const parent = node.parent
        if (parent && parent.type === 'MemberExpression' && parent.property === node) return
        if (parent && parent.type === 'Property' && parent.key === node) return
        context.report({ node, messageId: 'forbiddenGlobal', data: { name: node.name } })
      },
    }
  },
}

export default {
  rules: {
    'no-raw-hex-or-font-family': noRawHexOrFontFamily,
    'ml-core-import-boundary': mlCoreImportBoundary,
  },
}
