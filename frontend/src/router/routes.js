const routes = [
  {
    path: '/login',
    component: () => import('layouts/AuthLayout.vue'),
    children: [
      { path: '', name: 'login', component: () => import('pages/LoginPage.vue'), meta: { guestOnly: true } },
    ],
  },
  {
    path: '/register',
    component: () => import('layouts/AuthLayout.vue'),
    children: [
      { path: '', name: 'register', component: () => import('pages/RegisterPage.vue'), meta: { guestOnly: true } },
    ],
  },
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/h1-strategy' },
      { path: 'dashboard', name: 'dashboard', component: () => import('pages/DashboardPage.vue') },
      { path: 'watched-levels', name: 'watched-levels', component: () => import('pages/WatchedLevelsPage.vue') },
      { path: 'crash-ia', name: 'crash-ia', component: () => import('pages/CrashIaStrategyPage.vue') },
      { path: 'spike-strategy', name: 'spike-strategy', component: () => import('pages/Crash600SpikePage.vue') },
      { path: 'daily-report', name: 'daily-report', component: () => import('pages/TradingReportPage.vue') },
      { path: 'double-wick-strategy', name: 'double-wick-strategy', component: () => import('pages/DoubleWickStrategyPage.vue') },
      { path: 'm5plus-strategy', name: 'm5plus-strategy', component: () => import('pages/M5PlusStrategyPage.vue') },
      { path: 'm5x-strategy', name: 'm5x-strategy', component: () => import('pages/M5XStrategyPage.vue') },
      { path: 'h1-strategy', name: 'h1-strategy', component: () => import('pages/H1StrategyPage.vue') },
      { path: 'comparison', name: 'comparison', component: () => import('pages/ComparisonPage.vue') },
      { path: 'ticks', name: 'ticks', component: () => import('pages/TicksPage.vue') },
      { path: 'candles', name: 'candles', component: () => import('pages/CandlesPage.vue') },
      { path: 'account', name: 'account', component: () => import('pages/AccountPage.vue') },
      { path: 'update-profile', name: 'update-profile', component: () => import('pages/UpdateProfilePage.vue') },
      {
        path: 'users',
        name: 'users-admin',
        component: () => import('pages/UsersAdminPage.vue'),
        meta: { adminOnly: true },
      },
    ],
  },
  { path: '/:catchAll(.*)*', component: () => import('pages/ErrorNotFound.vue') },
];

export default routes;
