import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyDSGcVPLr2S5CQhI8Lm8UVBAYoUD3fB-Bg",
  authDomain: "reservas-club-f10.firebaseapp.com",
  projectId: "reservas-club-f10",
  storageBucket: "reservas-club-f10.firebasestorage.app",
  messagingSenderId: "836276193806",
  appId: "1:836276193806:web:3c6ddbc11c3b9f90418a5f",
});
const auth = getAuth(app);
const db = getFirestore(app);

const CANCHAS = [1, 2, 3, 4];
const AJUSTES_BASE = { abre: 15, cierra: 23, semanaTarde: 60000, semanaNoche: 80000, viernes: 100000, finde: 90000 };
const ALTO_HORA = 64;

const $ = (id) => document.getElementById(id);
const estado = { fecha: hoyISO(), reservas: [], ajustes: { ...AJUSTES_BASE }, cancelarEscucha: null, editando: null, valorManual: false };

// ---------- Utilidades ----------
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function aFecha(iso) { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d); }
function aISO(f) { return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`; }
function sumarDias(iso, n) { const f = aFecha(iso); f.setDate(f.getDate() + n); return aISO(f); }
const plata = (n) => "$" + Math.round(n || 0).toLocaleString("es-CO");
function horaTexto(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const sufijo = hh >= 12 ? "p. m." : "a. m.";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${sufijo}`;
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("ver");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("ver"), 2600);
}

// ---------- Festivos de Colombia (Ley Emiliani) ----------
const cacheFestivos = {};
function pascua(a) {
  const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25);
  const h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4;
  const m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
  const mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1;
  return new Date(a, mes - 1, dia);
}
function alLunes(f) { const d = new Date(f); const dow = d.getDay(); if (dow !== 1) d.setDate(d.getDate() + ((8 - dow) % 7)); return d; }
function festivos(a) {
  if (cacheFestivos[a]) return cacheFestivos[a];
  const set = new Set();
  const fijo = (m, d) => set.add(aISO(new Date(a, m - 1, d)));
  const lunes = (m, d) => set.add(aISO(alLunes(new Date(a, m - 1, d))));
  const desdePascua = (n, moverLunes) => { const p = pascua(a); p.setDate(p.getDate() + n); set.add(aISO(moverLunes ? alLunes(p) : p)); };
  [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].forEach(([m, d]) => fijo(m, d));
  [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].forEach(([m, d]) => lunes(m, d));
  desdePascua(-3); desdePascua(-2); desdePascua(39, true); desdePascua(60, true); desdePascua(68, true);
  return (cacheFestivos[a] = set);
}
const esFestivo = (iso) => festivos(aFecha(iso).getFullYear()).has(iso);
function tipoDia(iso) {
  const dow = aFecha(iso).getDay();
  if (esFestivo(iso)) return "festivo";
  if (dow === 5) return "viernes";
  return dow === 6 || dow === 0 ? "finde" : "semana";
}

// ---------- Precios ----------
// Lunes a jueves: tarde y noche. Viernes: un solo precio. Sábado, domingo y festivos: un solo precio.
function precioHora(iso, h) {
  const a = estado.ajustes, tipo = tipoDia(iso);
  if (tipo === "viernes") return a.viernes;
  if (tipo !== "semana") return a.finde;
  return h < 18 ? a.semanaTarde : a.semanaNoche;
}
function calcularValor(iso, inicio, dur) {
  let total = 0;
  for (let t = inicio; t < inicio + dur - 1e-9; t += 0.5) total += precioHora(iso, t) / 2;
  return Math.round(total / 1000) * 1000;
}

// ---------- Sesión ----------
onAuthStateChanged(auth, (u) => {
  $("pantalla-login").hidden = !!u;
  $("app").hidden = !u;
  if (u) { cargarAjustes().then(() => irA(estado.fecha)); }
  else if (estado.cancelarEscucha) { estado.cancelarEscucha(); estado.cancelarEscucha = null; }
});
const erroresAuth = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/email-already-in-use": "Ese correo ya tiene cuenta. Dale a Entrar.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/operation-not-allowed": "El inicio de sesión con correo todavía no está activado en Firebase.",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
};
async function entrar(crear) {
  const correo = $("login-correo").value.trim(), clave = $("login-clave").value;
  $("login-error").textContent = "";
  if (!correo || clave.length < 6) { $("login-error").textContent = "Escribe tu correo y una contraseña de al menos 6 caracteres."; return; }
  try {
    if (crear) await createUserWithEmailAndPassword(auth, correo, clave);
    else await signInWithEmailAndPassword(auth, correo, clave);
  } catch (e) { $("login-error").textContent = erroresAuth[e.code] || "No se pudo entrar (" + e.code + ")."; }
}
$("form-login").addEventListener("submit", (e) => { e.preventDefault(); entrar(false); });
$("btn-crear-cuenta").addEventListener("click", () => entrar(true));
$("btn-salir").addEventListener("click", () => signOut(auth));

// ---------- Ajustes ----------
async function cargarAjustes() {
  try {
    const s = await getDoc(doc(db, "ajustes", "general"));
    estado.ajustes = { ...AJUSTES_BASE, ...(s.exists() ? s.data() : {}) };
  } catch (e) { console.error(e); toast("No pude leer los ajustes; uso los de siempre."); }
}
function opcionesHoras(select, desde, hasta, paso, valor) {
  select.innerHTML = "";
  for (let h = desde; h <= hasta + 1e-9; h += paso) {
    const o = document.createElement("option"); o.value = h; o.textContent = horaTexto(h); select.appendChild(o);
  }
  if (valor !== undefined) select.value = valor;
}
$("btn-ajustes").addEventListener("click", () => {
  const a = estado.ajustes;
  opcionesHoras($("a-abre"), 6, 20, 1, a.abre);
  opcionesHoras($("a-cierra"), 12, 24, 1, a.cierra);
  $("a-semana-tarde").value = a.semanaTarde; $("a-semana-noche").value = a.semanaNoche;
  $("a-viernes").value = a.viernes; $("a-finde").value = a.finde;
  $("dlg-ajustes").showModal();
});
$("form-ajustes").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nuevos = {
    abre: Number($("a-abre").value), cierra: Number($("a-cierra").value),
    semanaTarde: Number($("a-semana-tarde").value), semanaNoche: Number($("a-semana-noche").value),
    viernes: Number($("a-viernes").value), finde: Number($("a-finde").value),
  };
  if (nuevos.cierra <= nuevos.abre) { toast("La hora de cierre debe ser después de la de apertura."); return; }
  try {
    await setDoc(doc(db, "ajustes", "general"), nuevos);
    estado.ajustes = nuevos; $("dlg-ajustes").close(); pintar(); toast("Ajustes guardados");
  } catch (err) { console.error(err); toast("No se pudieron guardar los ajustes."); }
});

// ---------- Día ----------
function irA(iso) {
  estado.fecha = iso;
  $("fecha-input").value = iso;
  const f = aFecha(iso);
  const hoy = hoyISO();
  const nombre = f.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  $("fecha-texto").textContent = iso === hoy ? "Hoy, " + nombre : iso === sumarDias(hoy, 1) ? "Mañana, " + nombre : nombre;
  const tipo = tipoDia(iso);
  const a = estado.ajustes;
  $("fecha-tipo").textContent = tipo === "festivo" ? `Festivo · ${plata(a.finde)} la hora` : tipo === "finde" ? `Fin de semana · ${plata(a.finde)} la hora` : tipo === "viernes" ? `Viernes · ${plata(a.viernes)} la hora` : `Entre semana · ${plata(a.semanaTarde)} tarde / ${plata(a.semanaNoche)} noche`;
  if (estado.cancelarEscucha) estado.cancelarEscucha();
  estado.reservas = []; pintar();
  estado.cancelarEscucha = onSnapshot(query(collection(db, "reservas"), where("fecha", "==", iso)), (snap) => {
    estado.reservas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.inicio - b.inicio || a.cancha - b.cancha);
    pintar();
  }, (err) => { console.error(err); toast("No tengo permiso para leer las reservas. ¿Entraste con tu correo?"); });
}
$("dia-anterior").addEventListener("click", () => irA(sumarDias(estado.fecha, -1)));
$("dia-siguiente").addEventListener("click", () => irA(sumarDias(estado.fecha, 1)));
$("btn-hoy").addEventListener("click", () => irA(hoyISO()));
$("fecha-input").addEventListener("change", (e) => e.target.value && irA(e.target.value));

const activas = () => estado.reservas.filter((r) => r.estado !== "cancelada");
const cobrado = (r) => (r.estado === "pagada" ? r.valor : Math.min(r.abono || 0, r.valor));

function pintar() {
  const act = activas();
  // Las pagadas completas suman al total; los abonos van aparte hasta que esa reserva quede pagada
  const pagadas = act.filter((r) => r.estado === "pagada");
  const conAbono = act.filter((r) => r.estado !== "pagada" && (r.abono || 0) > 0);
  const horas = act.reduce((s, r) => s + r.duracion, 0);
  const esperado = act.reduce((s, r) => s + r.valor, 0);
  $("r-reservas").textContent = act.length;
  $("r-horas").textContent = `${horas.toLocaleString("es-CO")} ${horas === 1 ? "hora" : "horas"}`;
  $("r-pagado").textContent = plata(pagadas.reduce((s, r) => s + r.valor, 0));
  $("r-pagadas").textContent = `${pagadas.length} ${pagadas.length === 1 ? "pagada completa" : "pagadas completas"}`;
  $("r-abonos").textContent = plata(conAbono.reduce((s, r) => s + Math.min(r.abono, r.valor), 0));
  $("r-abonadas").textContent = `${conAbono.length} ${conAbono.length === 1 ? "reserva abonada" : "reservas abonadas"}`;
  $("r-pendiente").textContent = plata(act.reduce((s, r) => s + (r.valor - cobrado(r)), 0));
  $("r-esperado").textContent = `de ${plata(esperado)} del día`;
  pintarTablero(act);
  pintarLista();
}

function pintarTablero(act) {
  const t = $("tablero"), { abre, cierra } = estado.ajustes;
  t.innerHTML = "";
  const cab = (txt) => { const d = document.createElement("div"); d.className = "t-cab"; d.textContent = txt; t.appendChild(d); };
  cab("Hora"); CANCHAS.forEach((c) => cab("Cancha " + c));
  for (let h = abre; h < cierra; h++) {
    const hd = document.createElement("div"); hd.className = "t-hora"; hd.textContent = horaTexto(h); t.appendChild(hd);
    for (const c of CANCHAS) {
      const celda = document.createElement("div"); celda.className = "t-celda";
      const ocupada = act.some((r) => r.cancha === c && r.inicio < h + 1 && r.inicio + r.duracion > h);
      if (!ocupada) {
        const b = document.createElement("button");
        b.className = "t-libre"; b.setAttribute("aria-label", `Reservar cancha ${c} a las ${horaTexto(h)}`);
        b.innerHTML = '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        b.addEventListener("click", () => abrirReserva(null, { cancha: c, inicio: h }));
        celda.appendChild(b);
      }
      for (const r of act.filter((x) => x.cancha === c && Math.floor(x.inicio) === h)) {
        const b = document.createElement("button");
        b.className = "reserva e-" + r.estado;
        b.style.top = 4 + (r.inicio - h) * ALTO_HORA + "px";
        b.style.height = r.duracion * ALTO_HORA - 8 + "px";
        b.innerHTML = `<b></b><span></span>`;
        b.querySelector("b").textContent = r.cliente;
        b.querySelector("span").textContent = `${horaTexto(r.inicio)} · ${etiquetaEstado(r)}`;
        b.addEventListener("click", () => abrirReserva(r));
        celda.appendChild(b);
      }
      t.appendChild(celda);
    }
  }
}
function etiquetaEstado(r) {
  return { pendiente: "Sin pago", abonada: "Abonó " + plata(r.abono), pagada: "Pagada", cancelada: "Cancelada" }[r.estado] || r.estado;
}
function pintarLista() {
  const ul = $("lista"); ul.innerHTML = "";
  if (!estado.reservas.length) { ul.innerHTML = '<li class="vacio">No hay reservas este día. Toca una casilla libre o el botón naranja.</li>'; return; }
  for (const r of estado.reservas) {
    const li = document.createElement("li");
    if (r.estado === "cancelada") li.classList.add("cancelada");
    li.innerHTML = `<span class="l-hora"></span><span class="l-quien"><b></b><small></small></span><span class="l-valor"><b></b><br><span class="chip"></span></span>`;
    li.querySelector(".l-hora").textContent = horaTexto(r.inicio);
    li.querySelector(".l-quien b").textContent = r.cliente;
    li.querySelector(".l-quien small").textContent = `Cancha ${r.cancha} · ${r.duracion} h${r.telefono ? " · " + r.telefono : ""}`;
    li.querySelector(".l-valor b").textContent = plata(r.valor);
    const chip = li.querySelector(".chip"); chip.className = "chip e-" + r.estado; chip.textContent = etiquetaEstado(r);
    li.addEventListener("click", () => abrirReserva(r));
    ul.appendChild(li);
  }
}

// ---------- Formulario de reserva ----------
function abrirReserva(r, previo = {}) {
  estado.editando = r;
  estado.valorManual = !!r;
  const { abre, cierra } = estado.ajustes;
  opcionesHoras($("f-hora"), abre, cierra - 0.5, 0.5);
  $("reserva-titulo").textContent = r ? "Reserva de " + r.cliente : "Nueva reserva";
  $("f-cliente").value = r?.cliente || "";
  $("f-telefono").value = r?.telefono || "";
  $("f-fecha").value = r?.fecha || estado.fecha;
  $("f-cancha").value = r?.cancha || previo.cancha || 1;
  $("f-hora").value = r?.inicio ?? previo.inicio ?? (abre + 3 < cierra ? abre + 3 : abre);
  $("f-duracion").value = r?.duracion || 1;
  $("f-abono").value = r?.abono || 0;
  $("f-estado").value = r?.estado || "pendiente";
  $("f-notas").value = r?.notas || "";
  $("f-valor").value = r ? r.valor : calcularValor($("f-fecha").value, Number($("f-hora").value), Number($("f-duracion").value));
  $("f-aviso").textContent = "";
  $("btn-eliminar").hidden = !r;
  actualizarWhatsApp();
  $("dlg-reserva").showModal();
  if (!r) setTimeout(() => $("f-cliente").focus(), 50);
}
function recalcular() {
  if (estado.valorManual) return;
  $("f-valor").value = calcularValor($("f-fecha").value, Number($("f-hora").value), Number($("f-duracion").value));
}
["f-fecha", "f-hora", "f-duracion"].forEach((id) => $(id).addEventListener("change", recalcular));
$("f-valor").addEventListener("input", () => { estado.valorManual = true; });
$("f-abono").addEventListener("input", () => {
  const abono = Number($("f-abono").value) || 0, valor = Number($("f-valor").value) || 0;
  if ($("f-estado").value === "cancelada") return;
  $("f-estado").value = abono <= 0 ? "pendiente" : abono >= valor ? "pagada" : "abonada";
});
["f-telefono", "f-cliente", "f-hora", "f-fecha", "f-cancha"].forEach((id) => $(id).addEventListener("input", actualizarWhatsApp));

function telefonoWa(tel) {
  let d = (tel || "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) d = "57" + d;
  return d.length >= 11 ? d : "";
}
function actualizarWhatsApp() {
  const num = telefonoWa($("f-telefono").value), a = $("btn-whatsapp");
  if (!num) { a.hidden = true; return; }
  const f = aFecha($("f-fecha").value).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const msg = `Hola ${$("f-cliente").value.trim()}, te escribo del Club Deportivo F10. Tu reserva quedó para el ${f} a las ${horaTexto(Number($("f-hora").value))} en la cancha ${$("f-cancha").value}. ¡Te esperamos!`;
  a.href = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  a.hidden = false;
}

// Busca otra reserva activa que se cruce con esta (misma cancha y horas que se pisan)
async function choca(datos, idPropio) {
  let lista = activas();
  if (datos.fecha !== estado.fecha) {
    const s = await getDocs(query(collection(db, "reservas"), where("fecha", "==", datos.fecha)));
    lista = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.estado !== "cancelada");
  }
  return lista.find((r) => r.id !== idPropio && r.cancha === datos.cancha && datos.inicio < r.inicio + r.duracion && r.inicio < datos.inicio + datos.duracion);
}
$("form-reserva").addEventListener("submit", async (e) => {
  e.preventDefault();
  const datos = {
    cliente: $("f-cliente").value.trim(),
    telefono: $("f-telefono").value.trim(),
    fecha: $("f-fecha").value,
    cancha: Number($("f-cancha").value),
    inicio: Number($("f-hora").value),
    duracion: Number($("f-duracion").value),
    valor: Number($("f-valor").value) || 0,
    abono: Number($("f-abono").value) || 0,
    estado: $("f-estado").value,
    notas: $("f-notas").value.trim(),
  };
  if (!datos.cliente) { $("f-aviso").textContent = "Escribe el nombre de quien reserva."; return; }
  if (datos.inicio + datos.duracion > estado.ajustes.cierra) { $("f-aviso").textContent = `La reserva pasa de la hora de cierre (${horaTexto(estado.ajustes.cierra)}).`; return; }
  if (datos.estado !== "cancelada") {
    const otra = await choca(datos, estado.editando?.id);
    if (otra) { $("f-aviso").textContent = `La cancha ${datos.cancha} ya está reservada por ${otra.cliente} de ${horaTexto(otra.inicio)} a ${horaTexto(otra.inicio + otra.duracion)}.`; return; }
  }
  $("btn-guardar").disabled = true;
  try {
    if (estado.editando) await updateDoc(doc(db, "reservas", estado.editando.id), { ...datos, actualizada: serverTimestamp() });
    else await addDoc(collection(db, "reservas"), { ...datos, creada: serverTimestamp() });
    $("dlg-reserva").close();
    toast(estado.editando ? "Reserva actualizada" : "Reserva guardada");
    if (datos.fecha !== estado.fecha) irA(datos.fecha);
  } catch (err) { console.error(err); $("f-aviso").textContent = "No se pudo guardar. Revisa tu conexión."; }
  finally { $("btn-guardar").disabled = false; }
});
$("btn-eliminar").addEventListener("click", async () => {
  const r = estado.editando;
  if (!r || !confirm(`¿Eliminar la reserva de ${r.cliente}? Si solo no vino, mejor márcala como Cancelada.`)) return;
  try { await deleteDoc(doc(db, "reservas", r.id)); $("dlg-reserva").close(); toast("Reserva eliminada"); }
  catch (err) { console.error(err); toast("No se pudo eliminar."); }
});
$("btn-nueva").addEventListener("click", () => abrirReserva(null));
document.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ---------- Instalar como app (Android) ----------
let avisoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  avisoInstalar = e;
  $("btn-instalar").hidden = false;
});
$("btn-instalar").addEventListener("click", async () => {
  if (!avisoInstalar) return;
  avisoInstalar.prompt();
  const { outcome } = await avisoInstalar.userChoice;
  avisoInstalar = null;
  $("btn-instalar").hidden = true;
  if (outcome === "accepted") toast("¡Listo! Ya tienes Reservas F10 en tu pantalla de inicio");
});
window.addEventListener("appinstalled", () => { $("btn-instalar").hidden = true; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.error(e));
