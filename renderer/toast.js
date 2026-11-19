/* global rm, $, LOGO_SVG, avatarHtml */
const q = new URLSearchParams(location.search);
$('#logo').innerHTML = LOGO_SVG(14);
$('#dp').innerHTML = avatarHtml(q.get('avatar'), 's');
$('#who').textContent = `${q.get('name')} diyor ki:`;
$('#msg').textContent = q.get('text');
$('#x').onclick = (e) => { e.stopPropagation(); window.close(); };
document.body.onclick = () => rm.toastClick(q.get('id'));
