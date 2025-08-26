const playPauseBtn = document.getElementById('playPause');
const tracks = ['instruments', 'bass', 'vocals', 'drums'];
let isPlaying = false;

playPauseBtn.addEventListener('click', () => {
  if (!isPlaying) {
    tracks.forEach(t => {
      const audio = document.getElementById(t);
      audio.currentTime = 0;
      audio.play();
    });
    playPauseBtn.textContent = '⏸ Pause';
    isPlaying = true;
  } else {
    tracks.forEach(t => document.getElementById(t).pause());
    playPauseBtn.textContent = '▶ Play';
    isPlaying = false;
  }
});

document.querySelectorAll('.track').forEach(trackDiv => {
  const trackName = trackDiv.getAttribute('data-track');
  const audio = document.getElementById(trackName);
  const muteBtn = trackDiv.querySelector('.mute');
  const volumeSlider = trackDiv.querySelector('.volume');

  muteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute';
  });

  volumeSlider.addEventListener('input', () => {
    audio.volume = volumeSlider.value;
  });
});
