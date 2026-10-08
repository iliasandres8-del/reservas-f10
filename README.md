# Reservas · Club Deportivo F10

Sistema personal para registrar las reservas de las 4 canchas sintéticas del Club F10.

- Vista del día por cancha y hora, con casillas libres para reservar de un toque.
- Cliente, teléfono, valor, abono y estado (pendiente, abonada, pagada, cancelada).
- Precios automáticos por día y hora (entre semana / fin de semana y festivos de Colombia), editables desde la app.
- Resumen del día: reservas, horas, cobrado y por cobrar.
- Botón para escribirle al cliente por WhatsApp.

Hecho con HTML, CSS y JavaScript, con Firebase (Auth + Firestore). Solo la cuenta del administrador puede leer y escribir (ver `firestore.rules`).
