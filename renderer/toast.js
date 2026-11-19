/* global rm, t, $, LOGO_SVG, avatarHtml */
const q = new URLSearchParams(location.search);
$('#logo').innerHTML = LOGO_SVG(14);
$('#dp').innerHTML = avatarHtml(q.get('avatar'), 's');
$('#who').textContent = t('says', { name: q.get('name') });
$('#msg').textContent = q.get('text');
$('#x').onclick = (e) => { e.stopPropagation(); window.close(); };
document.body.onclick = () => rm.toastClick(q.get('id'));
