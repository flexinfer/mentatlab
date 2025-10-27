// Minimal CTM CogPak UI remote entry
// Exposes window.CTMRemote.mount(container, onRun?)
(function(){
  function mount(el, onRun){
    if(!el) return;
    var root = document.createElement('div');
    root.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    root.style.fontSize = '14px';
    root.style.color = 'var(--foreground, #e2e8f0)';
    root.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(148,163,184,0.2)">',
      '<div><strong>CTM</strong> • Continuous Thought Machine</div>',
      '<button id="ctm-run" style="padding:6px 10px;border:1px solid rgba(148,163,184,0.3);border-radius:6px;background:#2563eb;color:#fff">Run</button>',
      '</div>',
      '<div style="padding:12px">Minimal UI loaded. Click Run to schedule a CTM session.</div>'
    ].join('');
    el.innerHTML='';
    el.appendChild(root);
    var btn = root.querySelector('#ctm-run');
    if(btn){
      btn.addEventListener('click', function(){
        try{ onRun && onRun({ agent_id: 'mentatlab.ctm-cogpack', spec: { prompt: 'CTM demo' } }); }catch(e){}
      });
    }
  }
  window.CTMRemote = { mount: mount };
})();

