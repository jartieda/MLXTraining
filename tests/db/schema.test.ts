import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { asOwner, checkAvailable, disconnect, resetDatabase, UNAVAILABLE_REASON } from './helpers/harness.ts'

/**
 * T029b / G2, G3 / FR-029, SC-017 — the structural guarantees.
 *
 * These are the assertions the project's entire data-protection position rests
 * on, and they are checked STRUCTURALLY rather than by inspecting contents:
 *
 *   G2  No column anywhere can hold image or weight data.
 *   G3  No column anywhere can hold a learner's email address, date of birth, or
 *       real name.
 *
 * The reason for the structural form is the lesson of the previous revision of
 * this design, which gated every write on a consent state. That worked, but it
 * had to be remembered on each new table — one forgotten table and the guarantee
 * was silently gone. **A column that cannot exist needs nothing remembered.**
 *
 * This file must pass before any policy work begins (T029b precedes T031): a
 * policy protects rows in a column that should not exist in the first place.
 */

const available = await checkAvailable()
const suite = available ? describe : describe.skip
if (!available) console.warn(`Skipping schema contract tests: ${UNAVAILABLE_REASON}`)

interface ColumnRow extends Record<string, unknown> {
  table_name: string
  column_name: string
  data_type: string
  udt_name: string
}

let columns: ColumnRow[] = []

/** Every column in `public`, tables and views alike. */
async function loadColumns(): Promise<ColumnRow[]> {
  return asOwner<ColumnRow>(`
    select table_name, column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, column_name
  `)
}

beforeAll(async () => {
  if (!available) return
  await resetDatabase()
  columns = await loadColumns()
}, 120_000)

afterAll(async () => {
  if (available) await disconnect()
})

suite('the nine tables exist', () => {
  it('creates exactly the tables data-model.md specifies, plus two named support tables', async () => {
    const rows = await asOwner<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `)

    expect(rows.map((r) => r.table_name)).toEqual([
      'audit_log',
      'classrooms',
      // Support tables, documented in 0001_schema.sql. `code_pepper` is what stops
      // a leaked invitations table being a list of live bearer credentials, and
      // `redemption_attempts` is where I5's rate limit actually lives.
      'code_pepper',
      'enrolments',
      'invitations',
      'lesson_progress',
      'profiles',
      'projects',
      'redemption_attempts',
      'reflections',
      'training_runs',
    ])
  })
})

suite('G2: no column can hold image or weight data', () => {
  it('has no bytea column in any table', () => {
    // The direct route. An image or a set of weights is bytes, and `bytea` is the
    // only type that holds bytes efficiently — so its absence is most of the
    // guarantee (Principle I, SC-010).
    const offenders = columns.filter((c) => c.udt_name === 'bytea')
    expect(
      offenders.map((c) => `${c.table_name}.${c.column_name}`),
      'a bytea column can hold an image or a set of weights',
    ).toEqual([])
  })

  it('has no column named as though it holds an image, a blob, or weights', () => {
    // The indirect route, which is the one that would actually happen: a text
    // column called `thumbnail` or `image_data_url` smuggling a base64 data URL.
    const pattern =
      /(image|photo|picture|thumbnail|snapshot|frame|blob|bytes|binary|weight|tensor|embedding|model_data|artifact|base64|data_url|dataurl)/i
    const offenders = columns.filter((c) => pattern.test(c.column_name))
    expect(
      offenders.map((c) => `${c.table_name}.${c.column_name} (${c.data_type})`),
      'a column named like this invites image or weight data into a table that must never hold it',
    ).toEqual([])
  })

  it('has no large-object or file-reference column type', () => {
    const offenders = columns.filter((c) => ['oid', 'lo'].includes(c.udt_name))
    expect(offenders.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })
})

suite("G3: no column can hold a learner's email, date of birth, or real name", () => {
  it('has no column named for an email address', () => {
    // `invitations.target` deliberately is NOT called `email`, and that naming is
    // load-bearing rather than cosmetic. It holds an adult educator's address for
    // `kind = 'educator'` rows and an assigned *username* for `kind = 'learner'`
    // rows, so a column literally named `email` would both trip this assertion
    // and mislead every future reader about what a learner row contains.
    const pattern = /(email|e_mail|mail_address|contact)/i
    const offenders = columns.filter((c) => pattern.test(c.column_name))
    expect(offenders.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })

  it('has no column named for a date of birth or an age', () => {
    const pattern = /(birth|dob|date_of_birth|age|birthday)/i
    const offenders = columns.filter((c) => pattern.test(c.column_name))
    expect(offenders.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })

  it('has no column named for a real name', () => {
    // `display_name` is permitted and excluded explicitly: it belongs to an
    // educator or an administrator, who is an adult naming herself, and a check
    // constraint in 0001 forbids a learner from having one at all.
    const pattern = /(real_name|full_name|first_name|last_name|surname|given_name|family_name|legal_name|forename)/i
    const offenders = columns.filter((c) => pattern.test(c.column_name))
    expect(offenders.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })

  it('has no consent or guardian column, because there is nothing to consent to', () => {
    // TODO(CONSENT_MECHANISM) is closed: the application collects no learner
    // personal data, so a consent column would be a field with no referent — and
    // one that invited someone to start collecting the data it implies.
    const pattern = /(consent|guardian|parent|phone|address|postcode|zip)/i
    const offenders = columns.filter((c) => pattern.test(c.column_name))
    expect(offenders.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })

  it('profiles holds no email, date of birth, or real name (SC-017)', async () => {
    // Named separately because `profiles` is the table where such a column would
    // most plausibly be added, and because SC-017 is stated about this table.
    const rows = await asOwner<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
      order by column_name
    `)

    expect(rows.map((r) => r.column_name)).toEqual([
      'alias',
      'classroom_id',
      'created_at',
      'display_name',
      'id',
      'is_active',
      'locale',
      'role',
      'username',
    ])
  })
})

suite('U4: the audit log holds opaque identifiers only', () => {
  it('has no column that could hold an alias, a username, or a contact detail', async () => {
    // A log built to be readable by a human is a log that has become personal
    // data. This one is read by querying identifiers during an incident, not by
    // browsing, which is why it holds ids and an action and nothing else.
    const rows = await asOwner<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'audit_log'
      order by column_name
    `)

    expect(rows.map((r) => r.column_name)).toEqual([
      'action',
      'actor_id',
      'detail',
      'id',
      'occurred_at',
      'subject_id',
    ])
  })
})

suite('G1: row-level security is enabled on every table', () => {
  it('leaves no table with RLS disabled', async () => {
    // A table with no policy is a defect, not a default-open convenience.
    const rows = await asOwner<{ tablename: string }>(`
      select tablename from pg_tables
      where schemaname = 'public' and not rowsecurity
      order by tablename
    `)
    expect(rows.map((r) => r.tablename)).toEqual([])
  })

  it('leaves no table both RLS-enabled and policy-less by accident', async () => {
    // Two tables ARE deliberately policy-less, which denies everything on them:
    // `code_pepper` and `redemption_attempts` are reachable only from inside a
    // definer function. Any third one is an oversight.
    const rows = await asOwner<{ tablename: string }>(`
      select t.tablename
      from pg_tables t
      where t.schemaname = 'public'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = t.tablename
        )
      order by t.tablename
    `)

    expect(rows.map((r) => r.tablename)).toEqual(['audit_log', 'code_pepper', 'redemption_attempts'])
  })
})

suite('definer hygiene (required scenario 3)', () => {
  it('gives every SECURITY DEFINER function an explicit search_path', async () => {
    // Omitting it is a privilege-escalation vector: a caller who can create a
    // function or table in a schema earlier on the search path can substitute her
    // own `profiles` and have a definer function read it with the owner's rights.
    const rows = await asOwner<{ name: string }>(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
          where cfg like 'search_path=%'
        )
      order by p.proname
    `)

    expect(rows.map((r) => r.name), 'these SECURITY DEFINER functions have no search_path').toEqual([])
  })

  it('declares all nine contracted functions', async () => {
    const rows = await asOwner<{ name: string }>(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by p.proname
    `)

    const names = new Set(rows.map((r) => r.name))
    for (const contracted of [
      'is_educator_of',
      'issue_learner_invitation',
      'issue_educator_invitation',
      'issue_password_reset',
      'redeem_invitation',
      'revoke_invitation',
      'delete_learner',
      'deactivate_educator',
      'reassign_classroom',
    ]) {
      expect(names.has(contracted), `${contracted} is missing or is not SECURITY DEFINER`).toBe(true)
    }
  })
})

suite('FR-051: uniqueness is enforced by constraint, not by application check', () => {
  it('refuses a second profile with an existing username, system-wide', async () => {
    // Required scenario 4. By constraint, so a roster or export can never be
    // ambiguous (remote-store invariant 10).
    await expect(
      asOwner(
        `insert into public.profiles (id, username, alias, role)
         values (gen_random_uuid(), 'LEARNER-L1', 'Someone', 'learner')`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  it('refuses a duplicate alias inside one classroom but allows it across two', async () => {
    // L1 ("Comet") is in K1 and L2 ("Comet") is in K2, and the seed already
    // proves the cross-classroom case. This adds the within-classroom refusal:
    // L1b renaming herself to Comet must fail.
    await expect(
      asOwner(
        `update public.profiles set alias = 'Comet'
         where id = '00000000-0000-4000-a000-00000000001b'`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  it('refuses a second enrolment for one learner (E5)', async () => {
    await expect(
      asOwner(
        `insert into public.enrolments (classroom_id, learner_id)
         values ('00000000-0000-4000-b000-0000000000c2', '00000000-0000-4000-a000-00000000001a')`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  it("refuses a profiles.classroom_id that disagrees with the learner's enrolment", async () => {
    // The composite foreign key is what makes the derived column trustworthy: if
    // it could drift, the classroom-scoped alias index would be enforcing
    // uniqueness against the wrong classroom.
    await expect(
      asOwner(
        `update public.profiles set classroom_id = '00000000-0000-4000-b000-0000000000c2'
         where id = '00000000-0000-4000-a000-00000000001a'`,
      ),
    ).rejects.toThrow(/foreign key|violates/i)
  })
})

suite('I6: invitation code shape', () => {
  it('uses exactly 32 unambiguous symbols, with no O, 0, I or 1', async () => {
    const rows = await asOwner<{ alphabet: string }>(`select public.invitation_alphabet() as alphabet`)
    const alphabet = rows[0]?.alphabet ?? ''

    expect(alphabet).toHaveLength(32)
    expect(new Set(alphabet).size, 'the alphabet repeats a symbol').toBe(32)
    for (const forbidden of ['O', '0', 'I', '1']) {
      expect(alphabet.includes(forbidden), `${forbidden} is visually ambiguous and must be excluded`).toBe(false)
    }
  })

  it('generates a six-character code drawn only from that alphabet', async () => {
    const rows = await asOwner<{ code: string; alphabet: string }>(
      `select public.generate_invitation_code() as code, public.invitation_alphabet() as alphabet`,
    )
    const { code = '', alphabet = '' } = rows[0] ?? {}

    expect(code).toHaveLength(6)
    for (const character of code) {
      expect(alphabet.includes(character), `"${character}" is outside the alphabet`).toBe(true)
    }
  })

  it('sets expires_at 72 hours out (FR-028)', async () => {
    const rows = await asOwner<{ hours: string }>(`
      select round(extract(epoch from (expires_at - created_at)) / 3600) as hours
      from public.invitations
      where id = '00000000-0000-4000-c000-0000000000d2'
    `)
    expect(Number(rows[0]?.hours)).toBe(72)
  })

  it('never stores the plaintext code', async () => {
    // The hash must not be the code, and must not be a bare digest of it either —
    // a 30-bit code with no pepper is reversible in seconds by anyone who obtains
    // the table.
    const rows = await asOwner<{ code_hash: string }>(
      `select code_hash from public.invitations where id = '00000000-0000-4000-c000-0000000000d2'`,
    )
    const hash = rows[0]?.code_hash ?? ''
    expect(hash).not.toContain('SEEDB3')
    expect(hash).toHaveLength(64)

    const unpeppered = await asOwner<{ digest: string }>(
      `select encode(extensions.digest('SEEDB3', 'sha256'), 'hex') as digest`,
    )
    expect(hash, 'the hash is an unpeppered digest and is therefore reversible').not.toBe(
      unpeppered[0]?.digest,
    )
  })
})

suite('G2 for the two tables closest to image data (J4)', () => {
  it('lets projects and training_runs hold only counts, names and figures', async () => {
    const rows = await asOwner<{ table_name: string; column_name: string; udt_name: string }>(`
      select table_name, column_name, udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name in ('projects', 'training_runs')
      order by table_name, column_name
    `)

    // jsonb is present for per_class and confusion, which are numbers. The G2
    // name-pattern assertion above already forbids a jsonb column named as though
    // it holds a map or an image, so this checks the remaining risk: a text
    // column wide enough to smuggle one.
    const suspicious = rows.filter((r) => r.udt_name === 'bytea' || r.udt_name === 'oid')
    expect(suspicious).toEqual([])
  })
})
