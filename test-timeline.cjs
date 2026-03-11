#!/usr/bin/env node
const axios = require("axios");

const BASE = "http://localhost:3000";
const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

async function run() {
  console.log("🧪 Testing Timeline Backend\n");

  // 0. Login to get token
  console.log("0️⃣  Login");
  const loginRes = await api.post("/api/auth/sign-in/email", {
    email: "profiletest@example.com",
    password: "testpass123",
  });
  const token = loginRes.data.token;
  api.defaults.headers["Authorization"] = `Bearer ${token}`;
  console.log(`   Logged in! Token: ${token.substring(0, 10)}...  ✅\n`);

  // 1. Text entry
  console.log("1️⃣  POST — Create TEXT entry");
  const t = await api.post("/api/timeline", { type: "text", mood: "Happy", content: "Hello world!", location: "Mumbai" });
  const textId = t.data.data.id;
  console.log(`   id=${textId}  ✅\n`);

  // 2. Photo entry
  console.log("2️⃣  POST — Create PHOTO entry");
  const p = await api.post("/api/timeline", {
    type: "photo", mood: "V. Happy", caption: "Sunset",
    photoUris: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    photoUri: "https://example.com/a.jpg",
  });
  console.log(`   id=${p.data.data.id}  media=${p.data.data.media.length}  ✅\n`);

  // 3. Story entry
  console.log("3️⃣  POST — Create STORY entry");
  const s = await api.post("/api/timeline", {
    type: "story", mood: "Normal", title: "Weekend",
    storyContent: "Page 1\n---\nPage 2", pageCount: 2,
    storyMedia: [{ uri: "https://example.com/img.jpg", type: "image" }],
  });
  console.log(`   id=${s.data.data.id}  media=${s.data.data.media.length}  ✅\n`);

  // 4. List
  console.log("4️⃣  GET — List entries");
  const list = await api.get("/api/timeline?limit=10");
  console.log(`   count=${list.data.data.length}  ✅\n`);

  // 5. Get by ID
  console.log("5️⃣  GET — Single entry");
  const single = await api.get(`/api/timeline/${textId}`);
  console.log(`   type=${single.data.data.type} content="${single.data.data.content}"  ✅\n`);

  // 6. Patch
  console.log("6️⃣  PATCH — Update entry");
  const patched = await api.patch(`/api/timeline/${textId}`, { mood: "V. Happy", caption: "Updated!" });
  console.log(`   mood=${patched.data.data.mood}  ✅\n`);

  // 7. Profile stats
  console.log("7️⃣  GET — Profile stats after entries");
  const prof = await api.get("/api/profile/me");
  console.log(`   entries=${prof.data.data.totalEntries} score=${prof.data.data.foldScore} streak=${prof.data.data.currentStreak}  ✅\n`);

  // 8. Delete
  console.log("8️⃣  DELETE — Delete entry");
  await api.delete(`/api/timeline/${textId}`);
  console.log(`   deleted ${textId}  ✅\n`);

  // Verify deletion
  const after = await api.get("/api/timeline?limit=10");
  console.log(`   Remaining entries: ${after.data.data.length}\n`);

  console.log("✅ All tests passed!");
}

run().catch((e) => {
  console.error("❌ Failed:", e.response?.data || e.message);
  process.exit(1);
});
