-- Structured questionnaire data for aggregate research. No participant/group
-- codes, free-text responses, account ids, or client-supplied timestamps are stored.
create function public.is_valid_anonymous_quiz_answers(p_answers jsonb, p_phase text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  answer record;
begin
  if coalesce(jsonb_typeof(p_answers), '') <> 'object' then
    return false;
  end if;

  if p_phase = 'pre' then
    return p_answers = '{}'::jsonb;
  end if;

  if p_phase <> 'post'
     or jsonb_object_length(p_answers) <> 12
     or (p_answers - array[
       'q1', 'q2', 'q3', 'q4', 'q5', 'q6',
       'q7', 'q8', 'q9', 'q10', 'q11', 'q12'
     ]) <> '{}'::jsonb then
    return false;
  end if;

  for answer in select key, value from jsonb_each(p_answers) loop
    if jsonb_typeof(answer.value) <> 'string'
       or answer.value #>> '{}' not in ('a', 'b', 'c', 'd', 'idk') then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create function public.is_valid_anonymous_quiz_likert(p_likert jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  rating record;
begin
  if coalesce(jsonb_typeof(p_likert), '') <> 'object'
     or jsonb_object_length(p_likert) <> 4
     or (p_likert - array['l1', 'l2', 'l3', 'l4']) <> '{}'::jsonb then
    return false;
  end if;

  for rating in select key, value from jsonb_each(p_likert) loop
    if rating.value <> 'null'::jsonb
       and (
         jsonb_typeof(rating.value) <> 'number'
         or rating.value #>> '{}' not in ('1', '2', '3', '4', '5')
       ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create table public.anonymous_quiz_submissions (
  submission_id uuid primary key,
  quiz_version text not null,
  phase text not null,
  quiz_type text not null,
  language text not null,
  answers jsonb not null,
  likert jsonb not null,
  country_code text not null,
  country_consent boolean not null,
  submitted_on date not null default ((now() at time zone 'UTC')::date),

  constraint anonymous_quiz_version_valid
    check (quiz_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  constraint anonymous_quiz_phase_valid
    check (phase in ('pre', 'post')),
  constraint anonymous_quiz_type_valid
    check (quiz_type in ('basic', 'advanced')),
  constraint anonymous_quiz_language_valid
    check (language in ('en', 'es')),
  constraint anonymous_quiz_answers_valid
    check (public.is_valid_anonymous_quiz_answers(answers, phase)),
  constraint anonymous_quiz_likert_valid
    check (public.is_valid_anonymous_quiz_likert(likert)),
  constraint anonymous_quiz_country_consent_valid
    check (country_code ~ '^[A-Z]{2}$' and country_consent is true)
);

alter table public.anonymous_quiz_submissions enable row level security;
revoke all on table public.anonymous_quiz_submissions from anon, authenticated;
grant select on table public.anonymous_quiz_submissions to service_role;

create function public.submit_anonymous_quiz(
  p_submission_id uuid,
  p_quiz_version text,
  p_phase text,
  p_quiz_type text,
  p_language text,
  p_answers jsonb,
  p_likert jsonb,
  p_country_code text,
  p_country_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_submission_id is null
     or coalesce(p_quiz_version, '') !~ '^[A-Za-z0-9._-]{1,32}$'
     or p_phase is null
     or p_phase not in ('pre', 'post')
     or p_quiz_type is null
     or p_quiz_type not in ('basic', 'advanced')
     or p_language is null
     or p_language not in ('en', 'es')
     or not public.is_valid_anonymous_quiz_answers(p_answers, p_phase)
     or not public.is_valid_anonymous_quiz_likert(p_likert)
     or p_country_code is null
     or p_country_code !~ '^[A-Z]{2}$'
     or p_country_consent is distinct from true then
    raise exception 'Invalid anonymous quiz submission';
  end if;

  insert into public.anonymous_quiz_submissions (
    submission_id,
    quiz_version,
    phase,
    quiz_type,
    language,
    answers,
    likert,
    country_code,
    country_consent
  )
  values (
    p_submission_id,
    p_quiz_version,
    p_phase,
    p_quiz_type,
    p_language,
    p_answers,
    p_likert,
    p_country_code,
    p_country_consent
  )
  on conflict (submission_id) do nothing;
end;
$$;

revoke all on function public.is_valid_anonymous_quiz_answers(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.is_valid_anonymous_quiz_likert(jsonb)
  from public, anon, authenticated;
revoke all on function public.submit_anonymous_quiz(uuid, text, text, text, text, jsonb, jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_anonymous_quiz(uuid, text, text, text, text, jsonb, jsonb, text, boolean)
  to anon, authenticated;

comment on table public.anonymous_quiz_submissions is
  'Structured, identifier-free questionnaire submissions for aggregate analysis. The application cannot read this table.';
