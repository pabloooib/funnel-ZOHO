/* ==========================================================================
   Meridian Capital — Lógica de frontend
   Persistencia basada en localStorage/sessionStorage.
   NOTA: este almacenamiento es solo para fines de demostración de frontend.
   En un entorno de producción, la autenticación y las contraseñas SIEMPRE
   deben manejarse en un backend seguro, nunca en el navegador.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Claves de almacenamiento                                            */
  /* ------------------------------------------------------------------ */
  const STORAGE_KEYS = {
    USERS: 'mc_users',
    LEADS: 'mc_leads',
    SESSION: 'mc_session',
    ZOHO_LINK: 'mc_zoho_link',
  };

  const STAGE_LABELS = {
    'lead': 'LEAD',
    'contactados': 'Contactados',
    'no-contactados': 'No contactados',
    'reunion': 'Reunión (agendada / realizada)',
    'prospecto': 'Prospecto (calificado)',
    'inscripcion': 'Proceso de inscripción',
  };

  const ZOHO_REQUIRED_STAGES = ['reunion', 'inscripcion'];

  /* ------------------------------------------------------------------ */
  /* Utilidades generales                                                 */
  /* ------------------------------------------------------------------ */
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $all = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function isValidEmail(value) {
    return EMAIL_REGEX.test(String(value).trim());
  }

  function isValidUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
      return false;
    }
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.error('Error leyendo localStorage:', err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error('Error escribiendo en localStorage:', err);
    }
  }

  function setFieldError(fieldId, message) {
    const errorEl = document.querySelector(`[data-error-for="${fieldId}"]`);
    const inputEl = document.getElementById(fieldId);
    if (errorEl) errorEl.textContent = message || '';
    if (inputEl) inputEl.classList.toggle('invalid', Boolean(message));
  }

  function clearErrors(form) {
    $all('.field-error', form).forEach((el) => (el.textContent = ''));
    $all('input', form).forEach((el) => el.classList.remove('invalid'));
  }

  /* ==================================================================== */
  /* 1. PESTAÑAS DE AUTENTICACIÓN (LOGIN / REGISTRO)                       */
  /* ==================================================================== */
  function initAuthTabs() {
    const tabs = $all('.auth-tab');
    const forms = {
      login: $('#loginForm'),
      register: $('#registerForm'),
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        Object.values(forms).forEach((f) => f.classList.remove('active'));
        forms[tab.dataset.tab].classList.add('active');
      });
    });
  }

  /* ==================================================================== */
  /* 2. FORMULARIO DE CAPTURA DE LEAD (HERO)                               */
  /* ==================================================================== */
  function initLeadForm() {
    const form = $('#leadForm');
    const confirmation = $('#leadConfirmation');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearErrors(form);

      const name = $('#leadName').value.trim();
      const email = $('#leadEmail').value.trim();
      const phone = $('#leadPhone').value.trim();

      let valid = true;

      if (!name) {
        setFieldError('leadName', 'Por favor, ingrese su nombre completo.');
        valid = false;
      }

      if (!email) {
        setFieldError('leadEmail', 'Por favor, ingrese su correo electrónico.');
        valid = false;
      } else if (!isValidEmail(email)) {
        setFieldError('leadEmail', 'El formato del correo electrónico no es válido.');
        valid = false;
      }

      if (!valid) {
        confirmation.hidden = true;
        return;
      }

      // Persistir el lead con su etapa inicial: LEAD
      const leads = readJSON(STORAGE_KEYS.LEADS, []);
      leads.push({
        id: `lead_${Date.now()}`,
        name,
        email,
        phone,
        stage: 'lead',
        zohoUrl: null,
        createdAt: new Date().toISOString(),
      });
      writeJSON(STORAGE_KEYS.LEADS, leads);

      confirmation.hidden = false;
      confirmation.textContent = `Gracias, ${name}. Su registro fue creado en la etapa LEAD. Un asesor se comunicará a ${email}.`;

      form.reset();
    });
  }

  /* ==================================================================== */
  /* 3. PANEL DE PIPELINE (RAIL DE ETAPAS)                                 */
  /* ==================================================================== */
  function initPipelineRail() {
    const cards = $all('.stage-card');
    const statusEl = $('#pipelineStatus');

    cards.forEach((card) => {
      const activate = () => {
        cards.forEach((c) => c.classList.remove('active-stage'));
        card.classList.add('active-stage');

        const stageKey = card.dataset.stage;
        const stageLabel = STAGE_LABELS[stageKey];
        const session = getActiveSession();

        if (session) {
          // Usuario autenticado: actualizar su etapa real
          updateUserStage(session.email, stageKey);
          statusEl.textContent = `Etapa actualizada a "${stageLabel}" para su cuenta.`;
        } else {
          statusEl.textContent = `Etapa seleccionada: "${stageLabel}". Inicie sesión para guardar este cambio en su cuenta.`;
        }

        if (ZOHO_REQUIRED_STAGES.includes(stageKey)) {
          statusEl.textContent += ' Recuerde vincular el enlace de Zoho CRM correspondiente.';
        }
      };

      card.addEventListener('click', activate);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
    });
  }

  /* ==================================================================== */
  /* 4. INTEGRACIÓN CON ZOHO CRM                                           */
  /* ==================================================================== */
  function initZohoPanel() {
    const zohoInput = $('#zohoUrl');
    const saveBtn = $('#saveZohoBtn');
    const openBtn = $('#openZohoBtn');
    const statusEl = $('#zohoStatus');

    // Precargar el enlace previamente guardado, si existe
    const savedLink = localStorage.getItem(STORAGE_KEYS.ZOHO_LINK);
    if (savedLink) {
      zohoInput.value = savedLink;
      statusEl.textContent = 'Enlace de Zoho previamente guardado cargado.';
    }

    saveBtn.addEventListener('click', () => {
      setFieldError('zohoUrl', '');
      const value = zohoInput.value.trim();

      if (!value) {
        setFieldError('zohoUrl', 'Ingrese un enlace antes de guardar.');
        return;
      }

      if (!isValidUrl(value)) {
        setFieldError('zohoUrl', 'Ingrese una URL válida (debe iniciar con http:// o https://).');
        return;
      }

      localStorage.setItem(STORAGE_KEYS.ZOHO_LINK, value);

      // Si hay un usuario con sesión activa, asociar el enlace a su cuenta
      const session = getActiveSession();
      if (session) {
        updateUserZoho(session.email, value);
        refreshSessionPanel();
      }

      statusEl.textContent = 'Enlace de Zoho guardado correctamente.';
    });

    openBtn.addEventListener('click', () => {
      const value = zohoInput.value.trim() || localStorage.getItem(STORAGE_KEYS.ZOHO_LINK);

      if (!value || !isValidUrl(value)) {
        statusEl.textContent = 'No hay un enlace de Zoho válido guardado todavía.';
        return;
      }

      window.open(value, '_blank', 'noopener');
    });
  }

  /* ==================================================================== */
  /* 5. GESTIÓN DE USUARIOS (REGISTRO / LOGIN / SESIÓN)                    */
  /* ==================================================================== */
  function getUsers() {
    return readJSON(STORAGE_KEYS.USERS, []);
  }

  function saveUsers(users) {
    writeJSON(STORAGE_KEYS.USERS, users);
  }

  function findUserByEmail(email) {
    return getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  function updateUserStage(email, stage) {
    const users = getUsers();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
      user.stage = stage;
      saveUsers(users);
    }
  }

  function updateUserZoho(email, zohoUrl) {
    const users = getUsers();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
      user.zohoUrl = zohoUrl;
      saveUsers(users);
    }
  }

  function setActiveSession(email, remember) {
    const payload = JSON.stringify({ email });
    if (remember) {
      localStorage.setItem(STORAGE_KEYS.SESSION, payload);
      sessionStorage.removeItem(STORAGE_KEYS.SESSION);
    } else {
      sessionStorage.setItem(STORAGE_KEYS.SESSION, payload);
      localStorage.removeItem(STORAGE_KEYS.SESSION);
    }
  }

  function getActiveSession() {
    const fromLocal = localStorage.getItem(STORAGE_KEYS.SESSION);
    const fromSession = sessionStorage.getItem(STORAGE_KEYS.SESSION);
    try {
      if (fromLocal) return JSON.parse(fromLocal);
      if (fromSession) return JSON.parse(fromSession);
    } catch (err) {
      console.error('Sesión corrupta en almacenamiento:', err);
    }
    return null;
  }

  function clearActiveSession() {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  }

  /* ---------------------- Formulario de registro ---------------------- */
  function initRegisterForm() {
    const form = $('#registerForm');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearErrors(form);
      setFieldError('registerForm', '');

      const name = $('#registerName').value.trim();
      const email = $('#registerEmail').value.trim();
      const password = $('#registerPassword').value;
      const confirmPassword = $('#registerConfirmPassword').value;
      const acceptTerms = $('#acceptTerms').checked;

      let valid = true;

      if (!name) {
        setFieldError('registerName', 'Ingrese su nombre completo.');
        valid = false;
      }

      if (!email) {
        setFieldError('registerEmail', 'Ingrese su correo electrónico.');
        valid = false;
      } else if (!isValidEmail(email)) {
        setFieldError('registerEmail', 'El formato del correo electrónico no es válido.');
        valid = false;
      } else if (findUserByEmail(email)) {
        setFieldError('registerEmail', 'Ya existe una cuenta registrada con este correo.');
        valid = false;
      }

      if (!password) {
        setFieldError('registerPassword', 'Ingrese una contraseña.');
        valid = false;
      } else if (password.length < 8) {
        setFieldError('registerPassword', 'La contraseña debe tener al menos 8 caracteres.');
        valid = false;
      }

      if (!confirmPassword) {
        setFieldError('registerConfirmPassword', 'Confirme su contraseña.');
        valid = false;
      } else if (password && confirmPassword !== password) {
        setFieldError('registerConfirmPassword', 'Las contraseñas no coinciden.');
        valid = false;
      }

      if (!acceptTerms) {
        setFieldError('acceptTerms', 'Debe aceptar los términos y condiciones para continuar.');
        valid = false;
      }

      if (!valid) return;

      // Persistir el nuevo usuario con su etapa inicial LEAD
      const users = getUsers();
      users.push({
        name,
        email,
        password, // Demostración de frontend únicamente — nunca almacenar contraseñas en claro en producción
        stage: 'lead',
        zohoUrl: localStorage.getItem(STORAGE_KEYS.ZOHO_LINK) || null,
        createdAt: new Date().toISOString(),
      });
      saveUsers(users);

      // Iniciar sesión automáticamente tras un registro exitoso
      setActiveSession(email, true);
      form.reset();
      renderSessionOrAuth();
    });
  }

  /* ------------------------ Formulario de login ------------------------ */
  function initLoginForm() {
    const form = $('#loginForm');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearErrors(form);
      setFieldError('loginForm', '');

      const email = $('#loginEmail').value.trim();
      const password = $('#loginPassword').value;
      const remember = $('#rememberMe').checked;

      let valid = true;

      if (!email) {
        setFieldError('loginEmail', 'Ingrese su correo electrónico.');
        valid = false;
      } else if (!isValidEmail(email)) {
        setFieldError('loginEmail', 'El formato del correo electrónico no es válido.');
        valid = false;
      }

      if (!password) {
        setFieldError('loginPassword', 'Ingrese su contraseña.');
        valid = false;
      }

      if (!valid) return;

      const user = findUserByEmail(email);

      if (!user || user.password !== password) {
        setFieldError('loginForm', 'Correo electrónico o contraseña incorrectos.');
        return;
      }

      setActiveSession(user.email, remember);
      form.reset();
      renderSessionOrAuth();
    });
  }

  /* --------------------------- Cerrar sesión ---------------------------- */
  function initLogout() {
    $('#logoutBtn').addEventListener('click', () => {
      clearActiveSession();
      renderSessionOrAuth();
    });
  }

  /* ------------------ "¿Olvidaste tu contraseña?" (demo) ---------------- */
  function initForgotPassword() {
    $('#forgotPasswordLink').addEventListener('click', (event) => {
      event.preventDefault();
      const emailField = $('#loginEmail');
      const email = emailField.value.trim();

      if (!email || !isValidEmail(email)) {
        setFieldError('loginEmail', 'Ingrese un correo válido para recuperar su contraseña.');
        emailField.focus();
        return;
      }

      setFieldError('loginForm', '');
      alert(`Si existe una cuenta asociada a ${email}, recibirá instrucciones para restablecer su contraseña.`);
    });
  }

  /* ------------------ Selector de etapa dentro de la sesión ------------- */
  function initSessionStageControl() {
    $('#stageSelect').addEventListener('change', (event) => {
      const session = getActiveSession();
      if (!session) return;

      updateUserStage(session.email, event.target.value);
      refreshSessionPanel();
    });

    $('#sessionOpenZoho').addEventListener('click', () => {
      const session = getActiveSession();
      const user = session ? findUserByEmail(session.email) : null;
      const link = (user && user.zohoUrl) || localStorage.getItem(STORAGE_KEYS.ZOHO_LINK);

      if (link && isValidUrl(link)) {
        window.open(link, '_blank', 'noopener');
      }
    });
  }

  /* ==================================================================== */
  /* 6. RENDERIZADO DEL PANEL DE SESIÓN vs. MÓDULO DE AUTENTICACIÓN        */
  /* ==================================================================== */
  function refreshSessionPanel() {
    const session = getActiveSession();
    if (!session) return;

    const user = findUserByEmail(session.email);
    if (!user) return;

    $('#sessionUserName').textContent = user.name;
    $('#sessionUserEmail').textContent = user.email;
    $('#sessionStage').textContent = STAGE_LABELS[user.stage] || STAGE_LABELS.lead;
    $('#stageSelect').value = user.stage || 'lead';

    const zohoUrlEl = $('#sessionZohoUrl');
    const openZohoBtn = $('#sessionOpenZoho');

    if (user.zohoUrl) {
      zohoUrlEl.textContent = user.zohoUrl;
      openZohoBtn.disabled = false;
    } else {
      zohoUrlEl.textContent = 'No se ha registrado un enlace todavía.';
      openZohoBtn.disabled = true;
    }
  }

  function renderSessionOrAuth() {
    const session = getActiveSession();
    const authCard = $('#authCard');
    const sessionPanel = $('#sessionPanel');

    if (session && findUserByEmail(session.email)) {
      authCard.hidden = true;
      sessionPanel.hidden = false;
      refreshSessionPanel();
    } else {
      authCard.hidden = false;
      sessionPanel.hidden = true;
    }
  }

  /* ==================================================================== */
  /* INICIALIZACIÓN                                                        */
  /* ==================================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initAuthTabs();
    initLeadForm();
    initPipelineRail();
    initZohoPanel();
    initRegisterForm();
    initLoginForm();
    initLogout();
    initForgotPassword();
    initSessionStageControl();

    renderSessionOrAuth();
  });
})();
