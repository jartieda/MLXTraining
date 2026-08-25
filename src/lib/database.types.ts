/**
 * T033 — hand-written database types matching supabase/migrations/.
 *
 * Written rather than generated, deliberately. `supabase gen types` needs a
 * running local instance, so a generated file would either be a build-time
 * dependency on Docker or a checked-in artifact nobody regenerates — and in both
 * cases the drift is silent. Hand-writing it means the shape is reviewed in the
 * same pull request as the migration that changes it.
 *
 * The column lists here mirror the GRANTs in 0003_rls.sql, not the base tables.
 * `profiles.username` and `invitations.code_hash` are therefore absent from the
 * Row types: no signed-in caller can select either, so a type that offered them
 * would describe a query that always fails.
 *
 * **`Relationships: []` on every entry is load-bearing, not boilerplate.**
 * postgrest-js requires it on each table and view for this type to satisfy its
 * `GenericSchema` constraint, and when the constraint fails the client silently
 * widens the whole schema instead of erroring — every `from()` and `rpc()` then
 * type-checks against nothing at all, which is worse than having no types, because
 * it reads as if it were checked. It is empty because nothing here traverses a
 * foreign key: the joins this application needs are done by the two views and by
 * `is_educator_of`, inside the policies (R9).
 */

export type AccountRole = 'learner' | 'educator' | 'administrator'
export type InvitationKind = 'educator' | 'learner'
export type InvitationPurpose = 'initial' | 'password_reset'
export type ProgressState = 'not_started' | 'in_progress' | 'completed'
export type UiLocale = 'en' | 'es'

export interface PerClassMetric {
  readonly classId: string
  readonly className: string
  readonly sampleCount: number
  readonly accuracy: number
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          alias: string
          role: AccountRole
          display_name: string | null
          is_active: boolean
          locale: UiLocale
          classroom_id: string | null
          created_at: string
        }
        Insert: never // G6: only `redeem_invitation` writes this table.
        // P4: exactly two columns are client-writable. A writable `role` would
        // let any learner promote herself; a writable `is_active` would let a
        // deactivated educator restore her own access.
        Update: { alias?: string; locale?: UiLocale }
        Relationships: []
      }

      classrooms: {
        Row: {
          id: string
          name: string
          educator_id: string
          archived_at: string | null
          created_at: string
        }
        Insert: { id?: string; name: string; educator_id: string }
        Update: { name?: string; archived_at?: string | null }
        Relationships: []
      }

      enrolments: {
        Row: { classroom_id: string; learner_id: string; enrolled_at: string }
        Insert: never // E1: created only by `redeem_invitation`.
        Update: never
        Relationships: []
      }

      invitations: {
        Row: {
          id: string
          issuer_id: string
          kind: InvitationKind
          purpose: InvitationPurpose
          target: string
          classroom_id: string | null
          expires_at: string
          failed_attempts: number
          redeemed_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: never // I4: issued only through the RPCs.
        Update: never
        Relationships: []
      }

      projects: {
        Row: {
          id: string
          owner_id: string
          name: string
          class_count: number
          sample_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          owner_id: string
          name: string
          class_count?: number
          sample_count?: number
          // Writable on insert because an upsert supplies it: `updated_at` defaults
          // to `now()` only on INSERT and no trigger advances it, so a conflicting
          // upsert that omitted it would leave the row claiming a time before the
          // work it just recorded.
          updated_at?: string
        }
        Update: { name?: string; class_count?: number; sample_count?: number; updated_at?: string }
        Relationships: []
      }

      training_runs: {
        Row: {
          id: string
          project_id: string
          finished_at: string
          per_class: PerClassMetric[]
          confusion: number[][]
          overall_accuracy: number
          imbalance_ratio: number | null
          backbone_alpha: number
          epochs: number
        }
        Insert: {
          id: string
          project_id: string
          per_class: PerClassMetric[]
          confusion: number[][]
          overall_accuracy: number
          imbalance_ratio?: number | null
          backbone_alpha: number
          epochs: number
        }
        Update: never // A recorded run is history; FR-010 compares runs rather than editing them.
        Relationships: []
      }

      lesson_progress: {
        Row: {
          learner_id: string
          module_id: string
          state: ProgressState
          completed_steps: string[]
          updated_at: string
        }
        Insert: {
          learner_id: string
          module_id: string
          state?: ProgressState
          completed_steps?: string[]
        }
        Update: { state?: ProgressState; completed_steps?: string[]; updated_at?: string }
        Relationships: []
      }

      reflections: {
        Row: {
          id: string
          learner_id: string
          module_id: string
          question_id: string
          answer: string
          updated_at: string
        }
        Insert: {
          id?: string
          learner_id: string
          module_id: string
          question_id: string
          answer: string
        }
        Update: { answer?: string; updated_at?: string }
        Relationships: []
      }

      // `audit_log` is absent on purpose. U1 makes it selectable by nobody, so
      // there is no client-side type for it — and no type to tempt anyone into
      // building the administrator audit screen FR-055 forbids.
    }

    Views: {
      /** P3: the only relation through which a username is readable. */
      educator_roster: {
        Row: {
          id: string
          username: string
          alias: string
          role: AccountRole
          is_active: boolean
          classroom_id: string | null
        }
        Relationships: []
      }
      /** K5: an administrator reads exactly these three columns. */
      admin_classrooms: {
        Row: { id: string; name: string; educator_id: string }
        Relationships: []
      }
    }

    Functions: {
      is_educator_of: { Args: { learner_id: string }; Returns: boolean }
      issue_learner_invitation: { Args: { classroom: string; username: string }; Returns: string }
      issue_educator_invitation: { Args: { email: string }; Returns: string }
      issue_password_reset: { Args: { learner: string }; Returns: string }
      redeem_invitation: {
        Args: { code: string; password: string; alias: string }
        Returns: string
      }
      revoke_invitation: { Args: { id: string }; Returns: undefined }
      delete_learner: { Args: { id: string }; Returns: undefined }
      deactivate_educator: { Args: { id: string }; Returns: undefined }
      reassign_classroom: { Args: { classroom: string; to_educator: string }; Returns: undefined }
    }

    Enums: {
      account_role: AccountRole
      invitation_kind: InvitationKind
      invitation_purpose: InvitationPurpose
      progress_state: ProgressState
      ui_locale: UiLocale
    }
  }
}
