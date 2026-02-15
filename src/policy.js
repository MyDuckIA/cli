const FALLBACK_OPENERS = {
  en: [
    "What outcome do you want first?",
    "What have you already tried?",
    "What constraint is blocking you right now?",
    "What is the smallest next step you can test?"
  ],
  fr: [
    "Quel resultat tu veux en premier ?",
    "Tu as deja essaye quoi exactement ?",
    "Quelle contrainte te bloque en ce moment ?",
    "Quel est le plus petit prochain test que tu peux faire ?"
  ]
};

export const DUCK_SYSTEM_PROMPT = [
  "You are My Duck, a rubber-duck thinking partner for developers.",
  "Non-negotiable behavior:",
  "- Never provide direct solutions.",
  "- Never provide final code to copy/paste.",
  "- Ask concise, useful questions that help the user think.",
  "- You may ask weird or playful questions, but stay relevant.",
  "- If user requests direct answers, refuse and ask a follow-up question.",
  "- Keep each response under 60 words.",
  "- End with at least one question."
].join("\n");

export function looksLikeSolutionRequest(input) {
  const text = input.toLowerCase();
  return [
    "give me the solution",
    "donne moi la solution",
    "write the code",
    "ecris le code",
    "solve it",
    "fix it for me",
    "do it for me",
    "donne la reponse",
    "fais le pour moi"
  ].some((needle) => text.includes(needle));
}

export function refusalQuestion(language = "en") {
  if (language === "fr") {
    return "Je suis un canard en plastique. Je ne donne pas la reponse. Tu as deja essaye quoi, exactement ?";
  }
  return "I am a plastic duck. I am not here to give the answer. What did you try already, exactly?";
}

export function enforceQuestionOnly(text, userInput, language = "en") {
  const clean = String(text || "").trim();
  if (!clean) {
    return localDuckQuestion(userInput, language);
  }

  const questions = clean
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?"));

  if (questions.length > 0) {
    const result = questions.slice(0, 2).join(" ");
    if (language === "fr" && detectLanguage(result) !== "fr") {
      return localDuckQuestion(userInput, "fr");
    }
    return result;
  }

  return localDuckQuestion(userInput, language);
}

export function localDuckQuestion(userInput, language = "en") {
  const lang = normalizeLanguage(language);
  const text = String(userInput || "").toLowerCase();

  if (text.includes("error") || text.includes("bug")) {
    return lang === "fr"
      ? "Quel est le message d'erreur exact, et a quel moment il apparait ?"
      : "What is the exact error message, and when does it appear?";
  }

  if (text.includes("architecture") || text.includes("design")) {
    return lang === "fr"
      ? "Quel compromis compte le plus ici: vitesse, simplicite, ou flexibilite ?"
      : "What tradeoff matters most for this decision: speed, simplicity, or flexibility?";
  }

  if (text.includes("performance") || text.includes("slow")) {
    return lang === "fr"
      ? "Quel est le goulot actuel que tu peux mesurer maintenant ?"
      : "What is the current bottleneck you can measure right now?";
  }

  const items = FALLBACK_OPENERS[lang] || FALLBACK_OPENERS.en;
  const pick = Math.floor(Math.random() * items.length);
  return items[pick];
}

export function detectLanguage(input) {
  const text = ` ${String(input || "").toLowerCase()} `;
  let fr = 0;
  let en = 0;

  if (/[àâçéèêëîïôùûüÿœ]/i.test(text)) {
    fr += 3;
  }

  const frenchHints = [
    " je ", " tu ", " il ", " elle ", " nous ", " vous ", " ils ", " elles ",
    " pourquoi ", " comment ", " quand ", " quoi ", " quel ", " quelle ",
    " avec ", " sans ", " pour ", " dans ", " est ", " sont ", " pas ",
    " deja ", " besoin ", " probleme ", " erreur ", " merci ", " bonjour "
  ];
  const englishHints = [
    " i ", " you ", " he ", " she ", " we ", " they ", " why ", " how ", " what ",
    " with ", " without ", " for ", " in ", " is ", " are ", " not ", " need ",
    " error ", " problem ", " thanks ", " hello "
  ];

  for (const token of frenchHints) {
    if (text.includes(token)) {
      fr += 1;
    }
  }
  for (const token of englishHints) {
    if (text.includes(token)) {
      en += 1;
    }
  }

  return fr >= en ? "fr" : "en";
}

function normalizeLanguage(language) {
  return language === "fr" ? "fr" : "en";
}
