import { route } from 'quasar/wrappers';
import { createRouter, createMemoryHistory, createWebHistory, createWebHashHistory } from 'vue-router';
import routes from './routes';
import { useAuthStore } from 'stores/auth.store';

export default route(function () {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  // Guard global: protege rutas con requiresAuth y evita que un usuario
  // ya logueado vuelva a ver login/register.
  Router.beforeEach(async (to) => {
    const authStore = useAuthStore();

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }

    if (to.meta.guestOnly && authStore.isAuthenticated) {
      return { name: 'dashboard' };
    }

    if (to.meta.adminOnly) {
      if (!authStore.user && authStore.isAuthenticated) {
        await authStore.fetchMe();
      }
      const email = (authStore.user?.email || '').trim().toLowerCase();
      if (email !== 'weimarsuber@gmail.com') {
        return { name: 'update-profile' };
      }
    }

    return true;
  });

  return Router;
});
