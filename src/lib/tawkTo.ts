export const TAWK_PROPERTY_ID = "6a0cb4984df5121c33c41874";
export const TAWK_WIDGET_ID_ARMENIAN = "1jp0q2t5g";
export const TAWK_WIDGET_ID_ENGLISH = "1jt38mkck";

export function buildTawkEmbedScript(widgetId: string) {
  return `
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
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
