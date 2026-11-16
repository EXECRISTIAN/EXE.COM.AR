// Panel → 🔌 Integraciones (permiso integrations.manage).
// Envíos (Envia.com), pago online (Mercado Pago) y facturación (ARCA): prender / apagar y completar sus datos.
//
// Reglas (no cambiar sin actualizar docs/INTEGRACIONES.md):
// - Apagada = la web queda exactamente como sin esa función (es el estado por defecto).
// - Prender pasa SIEMPRE por la función "integraciones", que verifica que estén cargadas todas las claves:
//   nada incompleto se muestra al público. Apagar es directo e inmediato.
// - Las claves secretas NO se cargan acá: van en Supabase → Edge Functions → Secrets.
(() => {
  const A = window.EXE_ADMIN;
  const { esc, $ } = A;
  const sb = () => A.be.sb;
  const cfg = window.SITE_CONFIG || {};

  const INFO = {
    envios: {
      icon: "📦", name: "Envíos (Envia.com)",
      what: "El cliente calcula el envío en el carrito con su código postal (Andreani, Correo Argentino, OCA…) y en Pedidos aparece <b>Crear envío</b> para generar la guía y la etiqueta.",
      off: "Apagado: el carrito no muestra el cálculo de envío y el envío se coordina por WhatsApp, como ahora.",
      steps: [
        "Crear la cuenta en envia.com y cargar saldo.",
        "En Envia: Configuración → Desarrolladores → Tokens de acceso → crear token.",
        "Supabase → Edge Functions → Secrets → agregar <code>ENVIA_TOKEN</code> con ese token.",
        "Completar abajo la dirección de despacho y los transportistas, y guardar.",
        "Probar con ambiente <b>Pruebas</b>; cuando funcione, pasar a <b>Producción</b>.",
      ],
    },
    mercadopago: {
      icon: "💳", name: "Pago online (Mercado Pago)",
      what: "En el carrito aparece <b>Pagar online con Mercado Pago</b> (para clientes con cuenta y productos con precio). El pedido se marca pagado solo cuando Mercado Pago acredita el pago, y ahí se descuenta el stock.",
      off: "Apagado: el carrito solo tiene \"Enviar pedido por WhatsApp\", como ahora.",
      steps: [
        "Mercado Pago → Tus integraciones → Crear aplicación (Checkout Pro, pagos online).",
        "Credenciales de producción → copiar el <b>Access Token</b> → Secret <code>MP_ACCESS_TOKEN</code> en Supabase.",
        `Webhooks → URL <code>${esc((cfg.supabaseUrl || "https://<proyecto>.supabase.co") + "/functions/v1/mp-webhook")}</code>, evento <b>Pagos</b>.`,
        "Copiar la <b>clave secreta</b> de esa pantalla de Webhooks → Secret <code>MP_WEBHOOK_SECRET</code>.",
        "Para probar sin cobrar: usar primero las credenciales de prueba en los mismos secrets.",
      ],
    },
    arca: {
      icon: "🧾", name: "Facturación (ARCA)",
      what: "En cada pedido pagado aparece <b>Emitir factura (ARCA)</b> (Factura C de monotributo, con CAE). Opcional: facturar solo cada pago de Mercado Pago. También permite consultar un CUIT o DNI en el padrón.",
      off: "Apagado: no aparece nada de facturación; se factura por fuera, como ahora.",
      steps: [
        "ARCA con clave fiscal → Administración de Certificados Digitales → generar el certificado (se arma con una clave privada .key que se crea en la computadora).",
        "ARCA → Administrador de Relaciones → asociar el certificado a los servicios <b>wsfe</b> (factura electrónica) y <b>ws_sr_padron_a13</b> (padrón).",
        "ARCA → Puntos de venta → crear uno del tipo <b>Web Services</b> y anotar el número.",
        "Supabase → Secrets: <code>ARCA_CERT</code> (texto completo del .crt) y <code>ARCA_KEY</code> (texto completo del .key).",
        "Completar abajo CUIT y punto de venta, guardar, y usar <b>Probar conexión</b>. Empezar en <b>Homologación</b> (pruebas) y después pasar a <b>Producción</b> (necesita otro certificado).",
      ],
    },
  };

  let rows = [], status = null, statusErr = "";

  async function fnCall(name, payload) {
    const { data: { session } } = await sb().auth.getSession();
    const r = await fetch(`${cfg.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload || {}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || (r.status === 404 ? "La función todavía no está publicada en Supabase" : `Error ${r.status}`));
    return d;
  }

  async function load() {
    if (A.demo) {
      rows = [{ key: "envios", enabled: false, config: { env: "test", carriers: "andreani,correo-argentino,oca" } },
        { key: "mercadopago", enabled: false, config: { pending_hours: 72 } },
        { key: "arca", enabled: false, config: { env: "homo", cuit: "", punto_venta: 1, cbte_tipo: 11 } }];
      status = { secrets: {}, ready: { envios: false, mercadopago: false, arca: false }, needs: { envios: ["ENVIA_TOKEN"], mercadopago: ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"], arca: ["ARCA_CERT", "ARCA_KEY"] } };
      return;
    }
    const { data, error } = await sb().rpc("integrations_admin");
    if (error) throw error;
    rows = data || [];
    try { status = await fnCall("integraciones"); statusErr = ""; } catch (e) { status = null; statusErr = e.message; }
  }

  const inp = (name, v, label, ph = "", extra = "") => `<label class="field">${label}<input name="${name}" value="${esc(v ?? "")}" placeholder="${esc(ph)}" ${extra}></label>`;
  const sel = (name, v, label, opts) => `<label class="field">${label}<select name="${name}">${opts.map(([k, t]) => `<option value="${k}" ${String(v) === String(k) ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;

  function fields(key, c) {
    if (key === "envios") {
      const o = c.origin || {};
      return `<div class="cd-grid">
          ${sel("env", c.env || "test", "Ambiente", [["test", "Pruebas"], ["prod", "Producción"]])}
          ${inp("carriers", c.carriers, "Transportistas (separados por coma)", "andreani,correo-argentino,oca")}
        </div>
        <h4>Dirección de despacho (remitente)</h4>
        <div class="cd-grid">
          ${inp("o_name", o.name, "Nombre", "EXE")}${inp("o_email", o.email, "Email", "ventas@exe.com.ar")}${inp("o_phone", o.phone, "Teléfono")}
          ${inp("o_street", o.street, "Calle")}${inp("o_number", o.number, "Número")}${inp("o_district", o.district, "Barrio")}
          ${inp("o_city", o.city, "Localidad")}${inp("o_state", o.state, "Provincia (código, ej. C = CABA, B = Bs. As.)")}${inp("o_postalCode", o.postalCode, "Código postal", "", 'inputmode="numeric" maxlength="4"')}
        </div>`;
    }
    if (key === "mercadopago") {
      return `<div class="cd-grid">${inp("pending_hours", c.pending_hours ?? 72, "Horas para pagar antes de que el pedido se cancele solo", "72", 'inputmode="numeric"')}</div>`;
    }
    return `<div class="cd-grid">
        ${inp("cuit", c.cuit, "CUIT de EXE (11 números)", "20123456789", 'inputmode="numeric" maxlength="13"')}
        ${inp("punto_venta", c.punto_venta ?? 1, "Punto de venta (Web Services)", "", 'inputmode="numeric"')}
        ${sel("cbte_tipo", c.cbte_tipo ?? 11, "Comprobante", [[11, "Factura C (monotributo)"], [6, "Factura B"], [1, "Factura A"]])}
        ${sel("env", c.env || "homo", "Ambiente", [["homo", "Homologación (pruebas)"], ["prod", "Producción"]])}
      </div>
      <label class="ed-check"><input type="checkbox" name="auto_invoice" ${c.auto_invoice ? "checked" : ""}> Facturar automáticamente cada pago acreditado por Mercado Pago (consumidor final)</label>`;
  }

  function readFields(key, f, old) {
    const v = (n) => (f.elements[n] ? f.elements[n].value.trim() : "");
    if (key === "envios") {
      const origin = {};
      for (const k of ["name", "email", "phone", "street", "number", "district", "city", "state", "postalCode"]) if (v("o_" + k)) origin[k] = v("o_" + k);
      if (origin.name) origin.company = origin.name;
      if (Object.keys(origin).length) origin.country = "AR";
      return { ...old, env: v("env") || "test", carriers: v("carriers"), origin };
    }
    if (key === "mercadopago") return { ...old, pending_hours: Math.max(1, Math.min(720, Number(v("pending_hours")) || 72)) };
    return { ...old, cuit: v("cuit").replace(/\D/g, ""), punto_venta: Math.max(1, Number(v("punto_venta")) || 1), cbte_tipo: Number(v("cbte_tipo")) || 11, env: v("env") || "homo", auto_invoice: !!f.elements.auto_invoice?.checked };
  }

  function card(r) {
    const i = INFO[r.key], c = r.config || {};
    const needs = status?.needs?.[r.key] || [];
    const ready = !!status?.ready?.[r.key];
    return `<section class="panel integ" data-key="${r.key}">
      <header class="integ-head"><h3>${i.icon} ${esc(i.name)}</h3>
        <span class="pill ${r.enabled ? "paid" : "cancelled"}">${r.enabled ? "Prendida" : "Apagada"}</span></header>
      <p>${i.what}</p><p class="ed-hint">${i.off}</p>
      <details${r.enabled ? "" : " open"}><summary><b>Cómo activarla</b></summary><ol>${i.steps.map((s) => `<li>${s}</li>`).join("")}</ol></details>
      <p><b>Claves en Supabase:</b> ${status ? needs.map((s) => `<span class="pill ${status.secrets[s] ? "paid" : "pending"}">${status.secrets[s] ? "✔" : "falta"} ${esc(s)}</span>`).join(" ") : `<span class="pill pending">${esc(statusErr || "sin datos")}</span>`}</p>
      <form class="integ-form">${fields(r.key, c)}
        <div class="integ-acts">
          <button class="btn btn-outline" type="submit">Guardar datos</button>
          ${r.enabled ? `<button class="btn btn-outline" type="button" data-off>Apagar</button>`
            : `<button class="btn btn-primary" type="button" data-on ${ready ? "" : "disabled title=\"Faltan claves en Supabase\""}>Prender</button>`}
          ${r.key === "arca" ? `<button class="btn btn-outline" type="button" data-test ${r.enabled ? "" : "disabled title=\"Prendela primero\""}>Probar conexión</button>` : ""}
          <span class="integ-msg" role="status"></span>
        </div>
      </form>
      ${r.key === "arca" && r.enabled ? `<form class="integ-padron"><label class="field">Consultar CUIT o DNI en el padrón<span class="ship-row"><input name="doc" inputmode="numeric" maxlength="13"><button class="btn btn-outline" type="submit">Consultar</button></span></label><div class="integ-out"></div></form>` : ""}
    </section>`;
  }

  A.views.integraciones = async function () {
    await load();
    const order = ["mercadopago", "envios", "arca"];
    return `<p class="ed-hint" style="margin-top:0">Todo arranca <b>apagado</b>: apagada, cada integración deja la web exactamente como sin esa función.
      Solo se puede <b>prender</b> cuando están cargadas todas sus claves (para que el público nunca vea algo a medio hacer). Apagar es inmediato.
      Las claves secretas se cargan en <b>Supabase → Edge Functions → Secrets</b>, nunca acá. Guía completa: <code>docs/INTEGRACIONES.md</code>.</p>
      ${order.map((k) => rows.find((r) => r.key === k)).filter(Boolean).map(card).join("")}`;
  };

  A.views.integraciones.after = () => {
    document.querySelectorAll(".integ").forEach((sec) => {
      const key = sec.dataset.key, row = rows.find((r) => r.key === key);
      const f = sec.querySelector(".integ-form"), msg = sec.querySelector(".integ-msg");
      const say = (t) => { msg.textContent = t; };
      const act = async (fn) => { if (A.demo) return say("Modo demo: acá se guardaría."); try { await fn(); A.route(); } catch (e) { say(e.message); } };
      f.onsubmit = (e) => { e.preventDefault(); act(async () => {
        const { error } = await sb().from("integrations").update({ config: readFields(key, f, row.config || {}) }).eq("key", key);
        if (error) throw error;
      }); };
      sec.querySelector("[data-on]")?.addEventListener("click", () => act(() => fnCall("integraciones", { action: "enable", key })));
      sec.querySelector("[data-off]")?.addEventListener("click", () => act(async () => {
        const { error } = await sb().from("integrations").update({ enabled: false }).eq("key", key);
        if (error) throw error;
      }));
      sec.querySelector("[data-test]")?.addEventListener("click", async () => {
        say("Conectando con ARCA…");
        try { const d = await fnCall("arca", { action: "status" }); say(`✔ Conectado (${d.ambiente === "prod" ? "producción" : "homologación"}). Último comprobante: ${d.ultimo_comprobante}.`); }
        catch (e) { say(e.message); }
      });
      const pf = sec.querySelector(".integ-padron");
      if (pf) pf.onsubmit = async (e) => {
        e.preventDefault();
        const out = pf.querySelector(".integ-out"); out.textContent = "Consultando…";
        try {
          const d = await fnCall("arca", { action: "padron", doc: pf.elements.doc.value.replace(/\D/g, "") });
          out.innerHTML = d.encontrado ? `<p><b>${esc(d.nombre)}</b> · CUIT ${esc(d.cuit)} · ${esc(d.tipo || "")} · ${esc(d.estado || "")}<br>${esc(d.domicilio || "")}</p>` : "<p>No se encontró.</p>";
        } catch (err) { out.textContent = err.message; }
      };
    });
  };
})();
