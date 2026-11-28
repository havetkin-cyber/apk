// keď sa 3D nenačíta, ukáž chybu (inak by bolo okno úplne priehľadné a nič by nebolo vidno)
function ukazChybu(t) {
  const el = document.getElementById('chyba');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = 'Postavička sa nenačítala: ' + t;
  try { window.postava.mys(true); } catch {}
}
addEventListener('error', (e) => ukazChybu(e.message || String(e.error)));
addEventListener('unhandledrejection', (e) => ukazChybu(e.reason?.message || String(e.reason)));
setTimeout(() => { if (!window.__postavaBezi) ukazChybu('3D sa nespustilo (skús reštart appky).'); }, 15000);
