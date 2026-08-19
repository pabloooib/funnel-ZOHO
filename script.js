/* =============================================================
   MERIDIAN — Gestión de Prospectos
   script.js — Firebase (Firestore) + lógica de interfaz
   ============================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ---------------------------------------------------------------
   1. INICIALIZACIÓN DE FIREBASE
--------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyB4YT9e1jg3nm7Fr8P8VHooffp3nQmIwMM",
  authDomain: "funnel-77b45.firebaseapp.com",
  projectId: "funnel-77b45",
  storageBucket: "funnel-77b45.firebasestorage.app",
  messagingSenderId: "346894896581",
  appId: "1:346894896581:web:0f603a594e5894e5b04fac",
  measurementId: "G-C6CM9433H3",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const leadsCollectionRef = collection(db, "leads");

/* ---------------------------------------------------------------
   2. ESTADO LOCAL DE LA APLICACIÓN
   (Se mantiene sincronizado en tiempo real con Firestore
   mediante onSnapshot; es la única fuente de verdad en memoria)
--------------------------------------------------------------- */
let allLeads = []; // [{ id, nombre, email, telefono, estado, enlaceZoho, responsable, fechaCreacion }]

const ESTADOS = [
  "LEAD",
  "Contactados",
  "No contactados",
  "Reunión",
  "Prospecto",
  "Proceso de Inscripción",
];

/* ---------------------------------------------------------------
   3. UTILIDADES
--------------------------------------------------------------- */

// Convierte un estado en un slug válido para usarlo como clase CSS / data-attribute
function slugify(text) {
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

// Formatea una fecha (Timestamp de Firestore, string ISO o Date) a formato legible
function formatFecha(fecha) {
  try {
    let dateObj;
    if (!fecha) return "—";
    if (typeof fecha.toDate === "function") {
      dateObj = fecha.toDate(); // Firestore Timestamp
    } else {
      dateObj = new Date(fecha);
    }
    if (isNaN(dateObj.getTime())) return "—";
    return dateObj.toLocaleDateString("es-GT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (e) {
    return "—";
  }
}

// Muestra una notificación tipo "toast"
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function setConnectionStatus(state) {
  const indicator = document.getElementById("connection-indicator");
  const label = document.getElementById("connection-label");
  indicator.classList.remove("online", "offline");
  if (state === "online") {
    indicator.classList.add("online");
    label.textContent = "Sincronizado en tiempo real";
  } else if (state === "offline") {
    indicator.classList.add("offline");
    label.textContent = "Sin conexión a la base de datos";
  } else {
    label.textContent = "Sincronizando…";
  }
}

/* ---------------------------------------------------------------
   4. NAVEGACIÓN ENTRE PESTAÑAS
--------------------------------------------------------------- */
function initNavigation() {
  const tabs = document.querySelectorAll(".nav-tab");
  const panels = document.querySelectorAll(".panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      panels.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.getElementById(tab.dataset.target).classList.add("active");
    });
  });
}

/* ---------------------------------------------------------------
   5. GUARDADO DE UN NUEVO LEAD EN FIRESTORE
--------------------------------------------------------------- */
function initForms() {
  const forms = document.querySelectorAll(".lead-form");

  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const responsable = form.dataset.formOwner; // "María José" o "José Pablo"
      const submitBtn = form.querySelector('button[type="submit"]');
      const feedback = form.querySelector("[data-feedback]");

      const formData = new FormData(form);
      const nuevoLead = {
        nombre: formData.get("nombre").trim(),
        email: formData.get("email").trim(),
        telefono: formData.get("telefono").trim(),
        estado: formData.get("estado"),
        enlaceZoho: (formData.get("enlaceZoho") || "").trim(),
        responsable: responsable,
        fechaCreacion: serverTimestamp(),
      };

      submitBtn.disabled = true;
      submitBtn.querySelector("span").textContent = "Guardando…";
      feedback.textContent = "";
      feedback.className = "form-feedback";

      try {
        await addDoc(leadsCollectionRef, nuevoLead);
        form.reset();
        feedback.textContent = "Prospecto registrado correctamente.";
        feedback.classList.add("success");
        showToast(`Prospecto "${nuevoLead.nombre}" registrado para ${responsable}.`, "success");
      } catch (error) {
        console.error("Error al guardar el lead:", error);
        feedback.textContent = "No se pudo guardar. Intenta nuevamente.";
        feedback.classList.add("error");
        showToast("Error al conectar con la base de datos.", "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.querySelector("span").textContent = "Registrar prospecto";
        setTimeout(() => {
          feedback.textContent = "";
          feedback.className = "form-feedback";
        }, 4000);
      }
    });
  });
}

/* ---------------------------------------------------------------
   6. SINCRONIZACIÓN EN TIEMPO REAL CON FIRESTORE
   (onSnapshot construido sobre la colección "leads";
   internamente reutiliza los helpers estándar de la API —
   getDocs/updateDoc/doc — para las operaciones puntuales)
--------------------------------------------------------------- */
function initRealtimeSync() {
  const leadsQuery = query(leadsCollectionRef, orderBy("fechaCreacion", "desc"));

  onSnapshot(
    leadsQuery,
    (snapshot) => {
      allLeads = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setConnectionStatus("online");
      renderAll();
    },
    (error) => {
      console.error("Error de sincronización con Firestore:", error);
      setConnectionStatus("offline");
      showToast("No fue posible sincronizar con Firestore.", "error");
    }
  );
}

// Consulta puntual de respaldo (usa getDocs) — se ejecuta una vez al cargar
// por si el listener en tiempo real tarda en establecerse.
async function fetchLeadsOnce() {
  try {
    const snapshot = await getDocs(leadsCollectionRef);
    if (allLeads.length === 0) {
      allLeads = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      renderAll();
    }
  } catch (error) {
    console.error("Error en consulta inicial:", error);
  }
}

// Actualiza el estado de un lead existente (disponible para uso futuro / edición en línea)
async function actualizarEstadoLead(leadId, nuevoEstado) {
  try {
    const leadRef = doc(db, "leads", leadId);
    await updateDoc(leadRef, { estado: nuevoEstado });
    showToast("Estado actualizado correctamente.", "success");
  } catch (error) {
    console.error("Error al actualizar el estado:", error);
    showToast("No se pudo actualizar el estado.", "error");
  }
}

/* ---------------------------------------------------------------
   7. RENDERIZADO — TABLAS POR SECCIÓN
--------------------------------------------------------------- */
function renderTablaResponsable(responsable, tbodySelector) {
  const tbody = document.querySelector(`[data-table-body="${responsable}"]`);
  if (!tbody) return;

  const leads = allLeads.filter((l) => l.responsable === responsable);
  const emptyState = tbody.closest(".table-scroll").querySelector("[data-empty-state]");

  tbody.innerHTML = "";

  if (leads.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    leads.forEach((lead) => {
      tbody.appendChild(buildRow(lead, { showResponsable: false }));
    });
  }

  // Actualiza contador
  const countTarget = responsable === "María José" ? "[data-count-mj]" : "[data-count-jp]";
  const countEl = document.querySelector(countTarget);
  if (countEl) {
    countEl.textContent = `${leads.length} registro${leads.length === 1 ? "" : "s"}`;
  }
}

// Construye una fila <tr> reutilizable para cualquier tabla
function buildRow(lead, { showResponsable }) {
  const tr = document.createElement("tr");
  const estadoSlug = slugify(lead.estado || "lead");

  const zohoCell = lead.enlaceZoho
    ? `<a class="zoho-link" href="${escapeHtml(lead.enlaceZoho)}" target="_blank" rel="noopener noreferrer">Ver en Zoho ↗</a>`
    : `<span class="zoho-link disabled">Sin enlace</span>`;

  const responsableCell = showResponsable
    ? `<td><span class="owner-tag"><span class="nav-dot ${
        lead.responsable === "María José" ? "dot-mj" : "dot-jp"
      }"></span>${escapeHtml(lead.responsable)}</span></td>`
    : "";

  tr.innerHTML = `
    <td class="cell-name">${escapeHtml(lead.nombre || "—")}</td>
    <td>
      <div class="cell-contact">
        <span class="contact-email">${escapeHtml(lead.email || "—")}</span>
        <span>${escapeHtml(lead.telefono || "—")}</span>
      </div>
    </td>
    <td><span class="status-badge status-${estadoSlug}">${escapeHtml(lead.estado || "—")}</span></td>
    ${responsableCell}
    <td>${zohoCell}</td>
    <td class="cell-date">${formatFecha(lead.fechaCreacion)}</td>
  `;

  return tr;
}

// Previene inyección HTML en campos de texto libre
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ---------------------------------------------------------------
   8. RENDERIZADO — VISTA UNIFICADA (KPIs + EMBUDO + TABLA)
--------------------------------------------------------------- */
function renderVistaUnificada() {
  renderKPIs();
  renderFunnel();
  renderTablaUnificada();
}

function renderKPIs() {
  const total = allLeads.length;
  const totalMJ = allLeads.filter((l) => l.responsable === "María José").length;
  const totalJP = allLeads.filter((l) => l.responsable === "José Pablo").length;
  const totalInscripcion = allLeads.filter((l) => l.estado === "Proceso de Inscripción").length;

  document.querySelector('[data-kpi="total"]').textContent = total;
  document.querySelector('[data-kpi="mj"]').textContent = totalMJ;
  document.querySelector('[data-kpi="jp"]').textContent = totalJP;
  document.querySelector('[data-kpi="inscripcion"]').textContent = totalInscripcion;
}

// Elemento distintivo de la vista unificada: embudo con ancho proporcional
function renderFunnel() {
  const container = document.querySelector("[data-funnel]");
  if (!container) return;

  const total = allLeads.length || 1; // evita división entre cero
  container.innerHTML = "";

  ESTADOS.forEach((estado) => {
    const count = allLeads.filter((l) => l.estado === estado).length;
    const pct = Math.round((count / total) * 100);
    const slug = slugify(estado);

    const segment = document.createElement("div");
    segment.className = "funnel-segment";
    segment.dataset.stage = slug;
    // El flex-grow determina el ancho proporcional (mínimo 1 para que sea visible)
    segment.style.flexGrow = Math.max(count, total === 1 && count === 0 ? 0 : 0.6);
    segment.style.flexBasis = "0";

    segment.innerHTML = `
      <span class="seg-pct">${pct}%</span>
      <span class="seg-count">${count}</span>
      <span class="seg-label">${estado}</span>
    `;
    container.appendChild(segment);
  });
}

function renderTablaUnificada() {
  const tbody = document.querySelector('[data-table-body="unificada"]');
  const emptyState = tbody.closest(".table-scroll").querySelector("[data-empty-state]");
  if (!tbody) return;

  const filtroEstado = document.querySelector("[data-filter-estado]").value;
  const filtroResponsable = document.querySelector("[data-filter-responsable]").value;

  const filtrados = allLeads.filter((lead) => {
    const coincideEstado = filtroEstado ? lead.estado === filtroEstado : true;
    const coincideResponsable = filtroResponsable ? lead.responsable === filtroResponsable : true;
    return coincideEstado && coincideResponsable;
  });

  tbody.innerHTML = "";

  if (filtrados.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    filtrados.forEach((lead) => {
      tbody.appendChild(buildRow(lead, { showResponsable: true }));
    });
  }
}

function initFiltros() {
  document.querySelector("[data-filter-estado]").addEventListener("change", renderTablaUnificada);
  document.querySelector("[data-filter-responsable]").addEventListener("change", renderTablaUnificada);
}

/* ---------------------------------------------------------------
   9. RENDER GENERAL (llamado cada vez que cambian los datos)
--------------------------------------------------------------- */
function renderAll() {
  renderTablaResponsable("María José");
  renderTablaResponsable("José Pablo");
  renderVistaUnificada();
}

/* ---------------------------------------------------------------
   10. EXPORTACIÓN A EXCEL (SheetJS / XLSX)
--------------------------------------------------------------- */
function initExportacion() {
  const btn = document.getElementById("btn-export");
  btn.addEventListener("click", () => {
    const filtroEstado = document.querySelector("[data-filter-estado]").value;
    const filtroResponsable = document.querySelector("[data-filter-responsable]").value;

    const datosFiltrados = allLeads.filter((lead) => {
      const coincideEstado = filtroEstado ? lead.estado === filtroEstado : true;
      const coincideResponsable = filtroResponsable ? lead.responsable === filtroResponsable : true;
      return coincideEstado && coincideResponsable;
    });

    if (datosFiltrados.length === 0) {
      showToast("No hay registros para exportar con el filtro actual.", "error");
      return;
    }

    // Estructura de filas para la hoja de cálculo
    const filas = datosFiltrados.map((lead) => ({
      "Nombre completo": lead.nombre || "",
      "Correo electrónico": lead.email || "",
      "Teléfono": lead.telefono || "",
      "Estado del prospecto": lead.estado || "",
      "Responsable": lead.responsable || "",
      "Enlace Zoho CRM": lead.enlaceZoho || "",
      "Fecha de creación": formatFecha(lead.fechaCreacion),
    }));

    const worksheet = XLSX.utils.json_to_sheet(filas);

    // Ajuste de ancho de columnas para mejor legibilidad
    worksheet["!cols"] = [
      { wch: 26 }, // Nombre
      { wch: 28 }, // Email
      { wch: 16 }, // Teléfono
      { wch: 22 }, // Estado
      { wch: 16 }, // Responsable
      { wch: 34 }, // Zoho
      { wch: 14 }, // Fecha
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Prospectos");

    const fechaArchivo = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Meridian_Prospectos_${fechaArchivo}.xlsx`);

    showToast(`Archivo Excel generado con ${filas.length} registro(s).`, "success");
  });
}

/* ---------------------------------------------------------------
   11. INICIALIZACIÓN GENERAL DE LA APLICACIÓN
--------------------------------------------------------------- */
function init() {
  initNavigation();
  initForms();
  initFiltros();
  initExportacion();
  setConnectionStatus("connecting");
  fetchLeadsOnce();
  initRealtimeSync();
}

document.addEventListener("DOMContentLoaded", init);

// Se exponen utilidades por si se requieren desde la consola / futuras vistas de edición
window.MeridianCRM = { actualizarEstadoLead, allLeads: () => allLeads };
