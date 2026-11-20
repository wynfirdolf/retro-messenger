/* global rm, Sounds */
// Hidden window that plays the sounds that don't belong to a visible window (start up, quit, sign out).
rm.on('play-global', async (name) => {
  await Sounds.play(name);
  rm.soundDone();
});
