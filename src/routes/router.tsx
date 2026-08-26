import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { Landing } from './Landing'
import { NotFound } from './NotFound'
import { LearnerRoute, RoleGate } from './RoleGate'

/**
 * T034 — the route table.
 *
 * Every route below the shell is `lazy`, and that is a budget decision rather
 * than a style one: the lab route pulls in TensorFlow.js and the lessons route
 * pulls in the seven modules' text, and SC-008 gives the *first* route three
 * seconds on a mid-range phone. Splitting here is what keeps the landing page
 * from paying for either.
 *
 * The one non-lazy pair is the shell and the landing page, since they are on
 * every first paint by definition.
 *
 * T135 adds the guards. They are **convenience, not enforcement**: the row-level
 * security policies are the boundary, and a client-side guard is removable by anyone
 * with developer tools open. What `RoleGate` buys is that the interface never offers
 * a route it will then refuse — see the note in RoleGate.tsx.
 */

const Projects = lazy(() =>
  import('@/features/projects/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
)
const Lab = lazy(() => import('@/features/capture/LabPage').then((m) => ({ default: m.LabPage })))
const Lessons = lazy(() =>
  import('@/features/lessons/LessonsPage').then((m) => ({ default: m.LessonsPage })),
)
const Classroom = lazy(() =>
  import('@/features/classroom/ClassroomPage').then((m) => ({ default: m.ClassroomPage })),
)
const Admin = lazy(() => import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const Login = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const Redeem = lazy(() =>
  import('@/features/auth/RedeemPage').then((m) => ({ default: m.RedeemPage })),
)
const ResetPassword = lazy(() =>
  import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Landing /> },

      // FR-023: reachable with no account. These are the whole product for an
      // anonymous visitor, which is why they sit alongside the landing page rather
      // than behind the login — and why `allowAnonymous` is set rather than the
      // routes being ungated. An administrator is still kept out (FR-055).
      { path: 'projects', element: <LearnerRoute>{<Projects />}</LearnerRoute> },
      { path: 'projects/:projectId', element: <LearnerRoute>{<Projects />}</LearnerRoute> },
      { path: 'lab/:projectId', element: <LearnerRoute>{<Lab />}</LearnerRoute> },
      { path: 'lab', element: <LearnerRoute>{<Lab />}</LearnerRoute> },

      { path: 'lessons', element: <LearnerRoute>{<Lessons />}</LearnerRoute> },
      { path: 'lessons/:moduleId', element: <LearnerRoute>{<Lessons />}</LearnerRoute> },

      {
        path: 'classroom',
        element: <RoleGate allow={['educator']}>{<Classroom />}</RoleGate>,
      },
      {
        path: 'classroom/:classroomId',
        element: <RoleGate allow={['educator']}>{<Classroom />}</RoleGate>,
      },

      {
        path: 'admin',
        element: <RoleGate allow={['administrator']}>{<Admin />}</RoleGate>,
      },

      { path: 'login', element: <Login /> },
      // The redemption route, and the only route by which an account can come into
      // existence. There is deliberately no `/signup` (FR-024) — not even one that
      // redirects, because a redirect implies the destination exists.
      { path: 'redeem', element: <Redeem /> },
      { path: 'reset', element: <ResetPassword /> },

      { path: '*', element: <NotFound /> },
    ],
  },
])
