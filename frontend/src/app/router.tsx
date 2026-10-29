/**
 * Knowledge AI — App Router
 */
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppLayout } from './shell/AppLayout';
import { Skeleton } from '@/components/shared';

// Route-level code splitting
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const ChatPage = lazy(() => import('@/features/chat/ChatPage'));
const UploadPage = lazy(() => import('@/features/upload/UploadPage'));
const CollectionsPage = lazy(() => import('@/features/collections/CollectionsPage'));
const ComparePage = lazy(() => import('@/features/compare/ComparePage'));
const SearchPage = lazy(() => import('@/features/search/SearchPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

function PageLoader() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-4 gap-4 mt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64 mt-4" />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: '/',
        element: (
          <Suspense fallback={<PageLoader />}>
            <DashboardPage />
          </Suspense>
        ),
      },
      {
        path: '/chat',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ChatPage />
          </Suspense>
        ),
      },
      {
        path: '/chat/:chatId',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ChatPage />
          </Suspense>
        ),
      },
      {
        path: '/upload',
        element: (
          <Suspense fallback={<PageLoader />}>
            <UploadPage />
          </Suspense>
        ),
      },
      {
        path: '/collections',
        element: (
          <Suspense fallback={<PageLoader />}>
            <CollectionsPage />
          </Suspense>
        ),
      },
      {
        path: '/compare',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ComparePage />
          </Suspense>
        ),
      },
      {
        path: '/search',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SearchPage />
          </Suspense>
        ),
      },
      {
        path: '/analytics',
        element: (
          <Suspense fallback={<PageLoader />}>
            <AnalyticsPage />
          </Suspense>
        ),
      },
      {
        path: '/settings',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SettingsPage />
          </Suspense>
        ),
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
