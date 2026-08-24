import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { Landing } from './Landing'
import { NotFound } from './NotFound'

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
 * Route guards (T135) are deliberately not here yet. They belong with US9, where
 * an administrator exists to be kept out of the lab, and adding them now would
 * mean writing a guard with no role to enforce against.
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

      // FR-023: reachable with no account. These two are the whole product for an
      // anonymous visitor, which is why they sit alongside the landing page rather
      // than behind the login.
      { path: 'projects', element: <Projects /> },
      { path: 'projects/:projectId', element: <Projects /> },
      { path: 'lab/:projectId', element: <Lab /> },
      { path: 'lab', element: <Lab /> },

      { path: 'lessons', element: <Lessons /> },
      { path: 'lessons/:moduleId', element: <Lessons /> },

      { path: 'classroom', element: <Classroom /> },
      { path: 'classroom/:classroomId', element: <Classroom /> },

      { path: 'admin', element: <Admin /> },

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
