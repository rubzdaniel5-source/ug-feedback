// Uganda Airlines Passenger Feedback — Service Worker
// Version: v1

const CACHE_NAME = 'ug-feedback-v1';
const CACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
];

// ── Install: cache all shell files ───────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for shell, network-first for API ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase API calls — network only (never cache)
  if(url.hostname.includes('supabase.co')){
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // App shell — cache first, fallback to network
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request)
        .then(response => {
          // Cache new successful responses
          if(response && response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return response;
        })
      )
      .catch(() => caches.match('./index.html'))
  );
});

// ── Background Sync — retry pending feedback ─────
self.addEventListener('sync', e => {
  if(e.tag === 'sync-feedback'){
    e.waitUntil(syncPendingFeedback());
  }
});

async function syncPendingFeedback(){
  const DB_NAME  = 'ug_feedback_db';
  const DB_STORE = 'pending_feedback';

  // Open IDB
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => res(req.result);
    req.onerror   = ()  => rej(req.error);
  });

  // Get all pending
  const pending = await new Promise((res, rej) => {
    const tx  = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });

  // Send each one
  for(const item of pending){
    try{
      const response = await fetch(
        'https://tirhpmfbfpveztjhudkm.supabase.co/rest/v1/passenger_feedback',
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpcmhwbWZiZnB2ZXp0amh1ZGttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDc5MDUwNTUsImV4cCI6MjAyMzQ4MTA1NX0.FbhzteHEIPkH4PaOSFMWWfGBMp03HMIhz9BcfxJMPBM',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpcmhwbWZiZnB2ZXp0amh1ZGttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDc5MDUwNTUsImV4cCI6MjAyMzQ4MTA1NX0.FbhzteHEIPkH4PaOSFMWWfGBMp03HMIhz9BcfxJMPBM',
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify(item),
        }
      );
      if(response.ok){
        // Delete from IDB on success
        const delTx  = db.transaction(DB_STORE, 'readwrite');
        delTx.objectStore(DB_STORE).delete(item.id);
        await new Promise((res, rej) => {
          delTx.oncomplete = res;
          delTx.onerror    = rej;
        });
      }
    }catch{ /* will retry on next sync */ }
  }
}
