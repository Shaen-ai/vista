export const TAWK_PROPERTY_ID = "6a0cb4984df5121c33c41874";
export const TAWK_WIDGET_ID_ARMENIAN = "1jp0q2t5g";
export const TAWK_WIDGET_ID_ENGLISH = "1jt38mkck";

export function buildTawkEmbedScript(widgetId: string) {
  return `
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
Tawk_API.onChatMaximized=function(){document.documentElement.classList.add('tawk-chat-maximized');};
Tawk_API.onChatMinimized=function(){document.documentElement.classList.remove('tawk-chat-maximized');};
(function(){
  var vv=window.visualViewport;
  if(!vv||!window.matchMedia('(max-width: 1024px)').matches)return;
  function sync(){
    var inset=Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop));
    var root=document.documentElement;
    root.style.setProperty('--tawk-vv-height',Math.round(vv.height)+'px');
    root.style.setProperty('--tawk-vv-offset-top',Math.round(vv.offsetTop)+'px');
    root.style.setProperty('--tawk-keyboard-inset',inset+'px');
  }
  vv.addEventListener('resize',sync);
  vv.addEventListener('scroll',sync);
  sync();
})();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/${TAWK_PROPERTY_ID}/${widgetId}';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();
`;
}
