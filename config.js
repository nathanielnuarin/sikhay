// config.js — Firebase configuration for Sikhay Creatives

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBnBPTxUyvyMx6lUJMmemG9Sfc-1E9zEs0",
  authDomain:        "sikhay-creatives.firebaseapp.com",
  projectId:         "sikhay-creatives",
  storageBucket:     "sikhay-creatives.firebasestorage.app",
  messagingSenderId: "85080433511",
  appId:             "1:85080433511:web:f616053804adf5de9a05c2",
  measurementId:     "G-FSD5JRJWY7"
};

// Preload Firebase compat SDK as early as possible so SikhayDB finds it ready
(function () {
  const V    = '10.12.0';
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']
    .forEach(name => {
      const src = `${base}/${name}`;
      if (!document.querySelector(`script[src="${src}"]`)) {
        const s = document.createElement('script');
        s.src   = src;
        document.head.appendChild(s);
      }
    });
})();
