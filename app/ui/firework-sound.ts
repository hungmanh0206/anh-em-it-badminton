// Firework sounds synthesised with Web Audio, so there is no audio file to host or load.
const NOISE_SECONDS = 2;

let context: AudioContext | null = null;

// Browsers only start sound from a tap or click, so the click that opens the celebration calls this.
export function unlockFireworkSound() {
  if (!window.AudioContext) return;
  context ??= new AudioContext();
  void context.resume();
}

function createNoise(audio: BaseAudioContext) {
  const buffer = audio.createBuffer(1, audio.sampleRate * NOISE_SECONDS, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  return buffer;
}

function playNoise(audio: BaseAudioContext, noise: AudioBuffer, output: AudioNode, time: number, length: number, volume: number) {
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  source.buffer = noise;
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + length);
  source.connect(gain).connect(output);
  source.start(time, Math.random() * (NOISE_SECONDS - length));
  source.stop(time + length);
}

// The rocket: a thin hiss rising in pitch for the length of its climb.
export function playLaunch(audio: BaseAudioContext, noise: AudioBuffer, output: AudioNode, pan: number, seconds: number) {
  const time = audio.currentTime;
  const panner = audio.createStereoPanner();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  panner.pan.value = pan;
  filter.type = "bandpass";
  filter.Q.value = 7;
  filter.frequency.setValueAtTime(500, time);
  filter.frequency.exponentialRampToValueAtTime(2600, time + seconds);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(0.35, time + seconds * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
  const source = audio.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.connect(filter).connect(gain).connect(panner).connect(output);
  source.start(time);
  source.stop(time + seconds);
}

// The burst: a low thump, a blast of noise that darkens as it fades, then the crackle of falling sparks.
export function playBurst(audio: BaseAudioContext, noise: AudioBuffer, output: AudioNode, pan: number, crackles: number) {
  const time = audio.currentTime;
  const strength = 0.65 + Math.random() * 0.35;
  const panner = audio.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(output);

  const thump = audio.createOscillator();
  const thumpGain = audio.createGain();
  thump.frequency.setValueAtTime(120, time);
  thump.frequency.exponentialRampToValueAtTime(38, time + 0.28);
  thumpGain.gain.setValueAtTime(strength, time);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
  thump.connect(thumpGain).connect(panner);
  thump.start(time);
  thump.stop(time + 0.45);

  const blast = audio.createBiquadFilter();
  blast.type = "lowpass";
  blast.frequency.setValueAtTime(3200, time);
  blast.frequency.exponentialRampToValueAtTime(240, time + 0.7);
  blast.connect(panner);
  playNoise(audio, noise, blast, time, 0.9, strength * 0.8);

  const crackle = audio.createBiquadFilter();
  crackle.type = "highpass";
  crackle.frequency.value = 3000;
  crackle.connect(panner);
  for (let index = 0; index < crackles; index += 1) {
    playNoise(audio, noise, crackle, time + 0.12 + Math.random() * 1.2, 0.02 + Math.random() * 0.03, 0.08 + Math.random() * 0.2);
  }
}

// Runs one celebration's sounds through a shared volume and a short open-air echo; null when sound is unavailable.
export function startFireworkSound() {
  const audio = context;
  if (!audio) return null;
  void audio.resume();
  const noise = createNoise(audio);
  const master = audio.createGain();
  const limiter = audio.createDynamicsCompressor();
  const echo = audio.createDelay(0.5);
  const echoTone = audio.createBiquadFilter();
  const echoGain = audio.createGain();
  master.gain.value = 0.55;
  echo.delayTime.value = 0.21;
  echoTone.type = "lowpass";
  echoTone.frequency.value = 900;
  echoGain.gain.value = 0.3;
  master.connect(limiter).connect(audio.destination);
  master.connect(echo).connect(echoTone).connect(echoGain).connect(limiter);
  echoGain.connect(echo);
  return {
    launch: (pan: number, seconds: number) => playLaunch(audio, noise, master, pan, seconds),
    burst: (pan: number, crackles: number) => playBurst(audio, noise, master, pan, crackles),
    stop: () => {
      master.disconnect();
      limiter.disconnect();
      void audio.suspend();
    },
  };
}
