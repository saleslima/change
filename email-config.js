/*
 * CONFIGURAÇÃO DO ENVIO DE E-MAIL (só front-end — GitHub Pages)
 *
 * Hospedagem estática: HTML/CSS/JS. Sem PHP, Node ou SMTP no servidor.
 *
 * Envio pelo navegador:
 * 1) FormSubmit — para o e-mail cadastrado
 * 2) EmailJS — reforço (no painel, To Email = {{to_email}})
 *
 * No 1º e-mail de um endereço novo, o FormSubmit pode pedir confirmação.
 */
window.CIVILOFF_EMAIL_CONFIG = Object.freeze({
  provider: 'formsubmit+emailjs',
  endpoint: 'https://api.emailjs.com/api/v1.0/email/send',
  publicKey: 'hM3Ta4FMcKReovWuI',
  serviceId: 'service_ajr1772',
  templateId: 'template_w6zv5bj',
  senderEmail: 'stqcopomsp@gmail.com',
  fromAddress: 'stqcopomsp@gmail.com',
  fromName: 'CivilOff'
});
