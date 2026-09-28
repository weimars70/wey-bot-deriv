<template>
  <div v-if="shouldShowComponent">
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- 1. BANNER FLOTANTE INFERIOR AUTOMÁTICO                             -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <transition
      appear
      enter-active-class="animated fadeInUp"
      leave-active-class="animated fadeOutDown"
    >
      <div v-if="showBanner" class="pwa-install-banner-wrap">
        <div class="pwa-install-banner-card shadow-24">
          <!-- Botón de cerrar / minimizar banner -->
          <q-btn
            flat
            round
            dense
            size="sm"
            icon="close"
            color="grey-4"
            class="pwa-close-btn"
            @click="dismissBanner"
          >
            <q-tooltip>Ahora no</q-tooltip>
          </q-btn>

          <div class="row items-center no-wrap q-gutter-sm">
            <!-- Icono de la App -->
            <div class="pwa-app-icon-wrap">
              <img
                src="/bot/icons/icon-192x192.png"
                alt="Deriv App"
                class="pwa-app-icon"
                @error="onIconError"
              />
            </div>

            <!-- Textos descriptivos -->
            <div class="col overflow-hidden">
              <div class="row items-center q-gutter-xs">
                <span class="text-weight-bolder text-white text-subtitle2 ellipsis">
                  Instalar Deriv App
                </span>
                <q-badge color="blue-6" text-color="white" label="Móvil" rounded class="text-caption font-bold" />
              </div>
              <div class="text-grey-4 text-caption leading-tight ellipsis-2-lines q-mt-xs">
                Acceso directo en tu pantalla, sin barras de navegación y con alertas en vivo.
              </div>
            </div>
          </div>

          <!-- Botones de Acción -->
          <div class="row items-center justify-between q-mt-sm q-gutter-xs">
            <q-btn
              flat
              dense
              no-caps
              icon="volume_up"
              label="Probar Sonido"
              color="amber-4"
              class="text-weight-bold q-px-xs text-caption"
              @click="testAudio"
            />
            <div class="row items-center q-gutter-xs">
              <q-btn
                flat
                dense
                no-caps
                label="Ahora no"
                color="grey-4"
                class="text-weight-medium q-px-sm text-caption"
                @click="dismissBanner"
              />
              <q-btn
                unelevated
                no-caps
                icon="download"
                label="Instalar App"
                color="primary"
                class="text-weight-bolder pwa-install-btn q-px-md"
                @click="triggerInstall"
              />
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- 2. BOTÓN FLOTANTE DISCRETO (Si minimizó el banner)                 -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <transition
      appear
      enter-active-class="animated scaleIn"
      leave-active-class="animated scaleOut"
    >
      <div v-if="!showBanner && showMiniBadge" class="pwa-mini-fab-wrap">
        <q-btn
          fab
          color="primary"
          icon="download_for_offline"
          class="pwa-mini-fab shadow-10 pulse-glow"
          @click="showBanner = true"
        >
          <q-badge color="negative" floating rounded>1</q-badge>
          <q-tooltip anchor="top middle" self="bottom middle">Instalar aplicación</q-tooltip>
        </q-btn>
      </div>
    </transition>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- 3. MODAL GUÍA DE INSTALACIÓN PASO A PASO (Para navegadores HTTP/iOS)-->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <q-dialog v-model="showGuideDialog" position="bottom" transition-show="slide-up" transition-hide="slide-down">
      <q-card class="pwa-guide-sheet bg-slate-900 text-white shadow-24">
        <div class="pwa-guide-indicator q-mx-auto q-my-sm"></div>

        <q-card-section class="q-pt-xs q-pb-none">
          <div class="row items-center justify-between">
            <div class="row items-center q-gutter-sm">
              <q-avatar size="38px" rounded class="bg-primary shadow-2">
                <img src="/bot/icons/icon-192x192.png" alt="Deriv" />
              </q-avatar>
              <div>
                <div class="text-subtitle1 text-weight-bolder">Cómo instalar la aplicación</div>
                <div class="text-caption text-grey-4">Solo toma 5 segundos en tu navegador</div>
              </div>
            </div>
            <q-btn flat round dense icon="close" color="grey-4" v-close-popup />
          </div>
        </q-card-section>

        <q-separator dark class="q-my-md opacity-20" />

        <!-- Pasos según sea Android o iOS -->
        <q-card-section class="q-py-none">
          <!-- CASO ANDROID (Chrome / Edge / Opera) -->
          <div v-if="isAndroid" class="q-gutter-y-md">
            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">1</div>
              <div class="col">
                <div class="text-weight-bold text-white">Toca los tres puntos arriba a la derecha</div>
                <div class="text-caption text-grey-4">
                  En la esquina superior de Chrome, presiona el icono de menú <strong>⋮</strong> (junto a las pestañas).
                </div>
              </div>
              <q-icon name="more_vert" size="28px" color="blue-4" />
            </div>

            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">2</div>
              <div class="col">
                <div class="text-weight-bold text-white">Selecciona "Instalar aplicación"</div>
                <div class="text-caption text-grey-4">
                  O presiona <strong>"Agregar a la pantalla principal"</strong> si aparece esa opción.
                </div>
              </div>
              <q-icon name="add_to_home_screen" size="28px" color="amber-4" />
            </div>

            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">3</div>
              <div class="col">
                <div class="text-weight-bold text-white">Confirma pulsando "Instalar"</div>
                <div class="text-caption text-grey-4">
                  ¡Listo! Se creará el acceso directo con el icono oficial y abrirá en pantalla completa.
                </div>
              </div>
              <q-icon name="check_circle" size="28px" color="positive" />
            </div>
          </div>

          <!-- CASO IOS (iPhone / iPad Safari) -->
          <div v-else-if="isIOS" class="q-gutter-y-md">
            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">1</div>
              <div class="col">
                <div class="text-weight-bold text-white">Toca el botón Compartir</div>
                <div class="text-caption text-grey-4">
                  En la barra inferior de Safari, pulsa el icono de compartir (el cuadrado con la flecha hacia arriba).
                </div>
              </div>
              <q-icon name="ios_share" size="28px" color="blue-4" />
            </div>

            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">2</div>
              <div class="col">
                <div class="text-weight-bold text-white">Elige "Agregar al inicio"</div>
                <div class="text-caption text-grey-4">
                  Desliza hacia abajo en el menú de Safari y pulsa <strong>"Agregar al inicio"</strong>.
                </div>
              </div>
              <q-icon name="add_box" size="28px" color="amber-4" />
            </div>

            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">3</div>
              <div class="col">
                <div class="text-weight-bold text-white">Toca "Agregar" arriba a la derecha</div>
                <div class="text-caption text-grey-4">
                  ¡Listo! Deriv App quedará instalada como app nativa en tu iPhone.
                </div>
              </div>
              <q-icon name="check_circle" size="28px" color="positive" />
            </div>
          </div>

          <!-- CASO GENÉRICO / NAVEGADORES PC MÓVIL -->
          <div v-else class="q-gutter-y-md">
            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">1</div>
              <div class="col">
                <div class="text-weight-bold text-white">Abre el menú de tu navegador</div>
                <div class="text-caption text-grey-4">
                  Presiona el menú de opciones o ajustes de tu navegador.
                </div>
              </div>
              <q-icon name="menu" size="28px" color="blue-4" />
            </div>
            <div class="guide-step-row row items-center q-gutter-md">
              <div class="guide-step-number bg-primary text-white">2</div>
              <div class="col">
                <div class="text-weight-bold text-white">Selecciona "Instalar" o "Agregar a inicio"</div>
                <div class="text-caption text-grey-4">
                  Confirma la instalación para disfrutar de la experiencia a pantalla completa.
                </div>
              </div>
              <q-icon name="get_app" size="28px" color="positive" />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="center" class="q-pa-md q-mt-sm">
          <q-btn
            unelevated
            rounded
            no-caps
            label="¡Entendido, voy a instalarla!"
            color="primary"
            class="full-width text-weight-bolder py-2 text-body2"
            v-close-popup
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useAlertsStore } from 'src/stores/alerts.store';

const alertsStore = useAlertsStore();

function testAudio() {
  alertsStore.testAudioAlert();
}

// Estados reactivos
const showBanner = ref(false);
const showMiniBadge = ref(false);
const showGuideDialog = ref(false);
const deferredPrompt = ref(null);
const isInstalled = ref(false);
const isMobileDevice = ref(false);

const isAndroid = computed(() => /Android/i.test(navigator.userAgent));
const isIOS = computed(() => /iPhone|iPad|iPod/i.test(navigator.userAgent));

const shouldShowComponent = computed(() => {
  return isMobileDevice.value && !isInstalled.value;
});

function checkInstalled() {
  // Comprueba si ya se está ejecutando en modo app nativa instalada (standalone)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');

  if (isStandalone) {
    isInstalled.value = true;
    return true;
  }
  return false;
}

function checkMobile() {
  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isSmallScreen = window.innerWidth <= 850;
  isMobileDevice.value = isMobileUa || isSmallScreen;
}

function onIconError(e) {
  // Si no encuentra el icono PNG, evitar romper la imagen
  e.target.style.display = 'none';
}

function dismissBanner() {
  showBanner.value = false;
  showMiniBadge.value = true;
  // Guardar en sessionStorage para no abrumar al usuario si recarga la página
  try {
    sessionStorage.setItem('pwa_banner_dismissed', '1');
  } catch {}
}

async function triggerInstall() {
  // 1. Si el navegador soporta y disparó el evento nativo `beforeinstallprompt`
  if (deferredPrompt.value) {
    try {
      deferredPrompt.value.prompt();
      const choiceResult = await deferredPrompt.value.userChoice;
      if (choiceResult.outcome === 'accepted') {
        isInstalled.value = true;
        showBanner.value = false;
        showMiniBadge.value = false;
      }
      deferredPrompt.value = null;
      return;
    } catch (err) {
      console.warn('Error al disparar install prompt:', err);
    }
  }

  // 2. Si no hay prompt nativo disponible (ej: Chrome en HTTP o Safari iOS), abrir guía interactiva
  showGuideDialog.value = true;
}

onMounted(() => {
  checkMobile();
  const alreadyInstalled = checkInstalled();

  if (alreadyInstalled || !isMobileDevice.value) {
    return;
  }

  // Escuchar el evento nativo del navegador para instalación
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt.value = e;
    // Mostrar banner de inmediato
    showBanner.value = true;
    showMiniBadge.value = false;
  });

  // Escuchar si la app fue instalada exitosamente
  window.addEventListener('appinstalled', () => {
    isInstalled.value = true;
    showBanner.value = false;
    showMiniBadge.value = false;
  });

  // Si no se ha descartado en esta sesión, desplegar el banner tras 1 segundo
  const wasDismissed = sessionStorage.getItem('pwa_banner_dismissed') === '1';
  if (!wasDismissed) {
    setTimeout(() => {
      if (!isInstalled.value && isMobileDevice.value) {
        showBanner.value = true;
      }
    }, 1200);
  } else {
    showMiniBadge.value = true;
  }
});
</script>

<style scoped>
/* Contenedor del banner flotante en la parte inferior */
.pwa-install-banner-wrap {
  position: fixed;
  bottom: 16px;
  left: 12px;
  right: 12px;
  z-index: 9999;
  max-width: 480px;
  margin: 0 auto;
}

.pwa-install-banner-card {
  position: relative;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.98));
  backdrop-filter: blur(16px);
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 16px;
  padding: 14px 16px 12px 14px;
  color: #fff;
  box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.6), 0 0 15px rgba(59, 130, 246, 0.2);
}

.pwa-close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0.75;
}
.pwa-close-btn:hover {
  opacity: 1;
}

.pwa-app-icon-wrap {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #1976d2;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(25, 118, 210, 0.4);
}

.pwa-app-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pwa-install-btn {
  border-radius: 10px;
  font-size: 0.85rem;
  box-shadow: 0 4px 14px rgba(25, 118, 210, 0.45);
}

/* Botón flotante mini badge */
.pwa-mini-fab-wrap {
  position: fixed;
  bottom: 24px;
  right: 20px;
  z-index: 9990;
}

.pwa-mini-fab {
  width: 52px;
  height: 52px;
  border-radius: 50%;
}

.pulse-glow {
  animation: pulse-ring 2.5s infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.6);
  }
  70% {
    box-shadow: 0 0 0 14px rgba(25, 118, 210, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0);
  }
}

/* Modal Bottom Sheet */
.pwa-guide-sheet {
  border-top-left-radius: 24px !important;
  border-top-right-radius: 24px !important;
  max-width: 500px;
  margin: 0 auto;
  padding-bottom: env(safe-area-inset-bottom, 16px);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.pwa-guide-indicator {
  width: 40px;
  height: 5px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}

.guide-step-row {
  background: rgba(255, 255, 255, 0.04);
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.guide-step-number {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.opacity-20 {
  opacity: 0.2;
}
</style>
