import type { APIRoute } from "astro";

export const prerender = false;

const MODEL_ID = "gemini-3.8-flash";

const SYSTEM_PROMPT = `Eres el diseñador 3D de Felynez (taller de juguetes gatunos antiestrés impresos en 3D).
Tu trabajo es conversar con el usuario en español y generar o modificar un **Clicker 3D** en tiempo real devolviendo SIEMPRE un JSON válido con esta estructura exacta:

{
  "reply": "Mensaje breve, cálido y claro en español explicando qué creaste o modificaste.",
  "spec": {
    "name": "Nombre corto del clicker (máx 30 caracteres)",
    "subtitle": "Etiqueta corta (máx 22 caracteres, ej. Edición Espacial)",
    "pressDepth": 0.3,
    "popFreq": 440,
    "emojis": ["💗", "🐾", "✨"],
    "scene": {
      "rugColor": "#c99e67",
      "ringColor": "#ffb84d",
      "accentLight": "#ff5c8a"
    },
    "baseParts": [
      {
        "shape": "box | cylinder | sphere | cone | torus | capsule | octahedron",
        "color": "#hex",
        "pos": [0, 0.5, 0],
        "rot": [0, 0, 0],
        "scale": [1, 1, 1],
        "roughness": 0.45,
        "metalness": 0.05
      }
    ],
    "catParts": [
      {
        "shape": "box | cylinder | sphere | cone | torus | capsule | octahedron",
        "color": "#hex",
        "pos": [0, 1.4, 0],
        "rot": [0, 0, 0],
        "scale": [1, 1, 1],
        "roughness": 0.4,
        "metalness": 0.05
      }
    ]
  }
}

Reglas de diseño 3D (MUY IMPORTANTE para que se vea tierno y bien proporcionado):
1. El suelo está en y = 0.
2. "baseParts" es la base fija donde se apoya o de donde sale el michi (ej. caja, taza, maceta, nube, cohete, pastel, calabaza). Debe ir desde y = 0 hasta aprox y = 1.05, centrado en x = 0, z = 0, con ancho aprox 1.6 a 2.4.
3. "catParts" es la parte móvil que se hunde y rebota al hacer clic (el gatito + sus accesorios). Debe ubicarse entre y = 0.95 y y = 2.4, centrado en x = 0, z = 0.
4. Por defecto cada forma base tiene tamaño unitario (~1 unidad):
   - "sphere": diámetro ~1 (radio 0.5). Usa scale [x, y, z] para aplastar o estirar.
   - "box": lado 1x1x1.
   - "cylinder": diámetro 1, altura 1.
   - "cone": diámetro base 1, altura 1 (ideal para orejitas de gato y gorros).
   - "torus": diámetro ~1 (ideal para aros, bordes de taza, collares, lentes, coronas).
   - "capsule": diámetro 0.6, altura total ~1.2 (ideal para patitas, bigotes, colita).
   - "octahedron": diámetro ~1 (ideal para gemas o estrellas).
5. Asegúrate de incluir siempre rasgos gatunos reconocibles en "catParts": cabeza (sphere), 2 orejitas (cone), 2 ojitos (sphere oscuros al frente en z > 0.35), naricita/hocico (sphere pequeña en z > 0.45), patitas opcionales, más los accesorios que pida el usuario (sombrero, lentes, casco, bufanda, etc.).
6. Si el usuario pide modificar algo del diseño actual, conserva el resto de "currentSpec" y aplica solo los cambios solicitados.
7. "rot" está en radianes [rx, ry, rz]. Todos los colores deben ser hex válidos "#RRGGBB".
8. Responde ÚNICAMENTE con el objeto JSON, sin markdown ni texto adicional.`;

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

async function callGemini(apiKey: string, body: unknown): Promise<Response> {
  return fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function extractTextFromResponse(data: any): string | undefined {
  if (Array.isArray(data?.outputs)) {
    for (let i = data.outputs.length - 1; i >= 0; i--) {
      const out = data.outputs[i];
      if (typeof out?.text === "string" && out.text.trim()) {
        return out.text;
      }
    }
  }
  if (typeof data?.candidates?.[0]?.content?.parts?.[0]?.text === "string") {
    return data.candidates[0].content.parts[0].text;
  }
  if (typeof data?.text === "string") {
    return data.text;
  }
  return undefined;
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = process.env["GEMINI_API_KEY"] || import.meta.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en el servidor (Vercel Environment Variables o .env)." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let payload: { messages?: ChatMessage[]; currentSpec?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Cuerpo JSON inválido." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-10) : [];
  if (messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "Envía al menos un mensaje para generar el clicker." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const historyText = messages
    .map((m) => `${m.role === "assistant" ? "Diseñador" : "Usuario"}: ${m.text}`)
    .join("\n");

  const fullInput = payload.currentSpec
    ? `Diseño actual (JSON):\n${JSON.stringify(payload.currentSpec)}\n\nHistorial:\n${historyText}`
    : historyText;

  const geminiBody = {
    model: MODEL_ID,
    system_instruction: SYSTEM_PROMPT,
    input: fullInput,
    response_mime_type: "application/json",
  };

  try {
    let res = await callGemini(apiKey, geminiBody);
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await callGemini(apiKey, geminiBody);
    }

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `Error ${res.status} de Gemini (${MODEL_ID}).`;
      return new Response(
        JSON.stringify({ error: msg, model: MODEL_ID }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const rawText = extractTextFromResponse(data);
    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "Gemini no devolvió contenido." }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

    return new Response(JSON.stringify({ ...parsed, model: MODEL_ID }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado al generar el clicker.";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
