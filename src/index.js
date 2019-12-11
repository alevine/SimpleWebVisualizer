"use strict";

import { analyze } from 'web-audio-beat-detector';

// Web audio context for playing the actual song
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Offline context for rendering filtered song and obtaining BPM
const offlineAudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
const offlineCtx = new offlineAudioCtx(2, 30 * 44100, 44100);

// DOM objects for reference
const form = document.getElementById('input-form');
const stopButton = document.getElementById('stop_button');
const fileInput = document.getElementById('audio_input');
const playButton = document.getElementById('play_button');
const loadButton = document.getElementById('load_button');
const videoPlayer = document.getElementById('animation_video');

// Canvas objects
const canvas = document.getElementById('canvas');
const canvasCtx = canvas.getContext('2d');

const reader = new FileReader();

// Strings for animation source locations
const videoSources = [
    '../static/circle_diagonal_2.mp4',
    '../static/square_diagonal_1.mp4',
    '../static/square_diagonal_2.mp4',
    '../static/circle_pulse_1.mp4',
    '../static/square_pulse_1.mp4',
    '../static/circle_form_2.mp4',
    '../static/circle_form.mp4'
]

// Audio vars to be set later
let audioBufferSource = null;
let analyser = null;

// Vars for the audio buffer and data array
let dataArray = null;
let bufferLength = null;

// Vars for the interval function to stop later
let runningInterval = null;

let libTempo = null;

// Obtain the data stored in the form and create an audio buffer using it
function getAudioBuffer() {
    // File in the input field
    const file = fileInput.files[0];

    // Create buffer sources, analyser, and filter
    audioBufferSource = audioCtx.createBufferSource();
    const lowPassSource = offlineCtx.createBufferSource();

    analyser = audioCtx.createAnalyser();

    const lowPassFilter = offlineCtx.createBiquadFilter();
    const highPassFilter = offlineCtx.createBiquadFilter();

    // Filters for my BPM analyzer
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = 225;
    lowPassFilter.Q.value = 1;

    // A 'kick' or beat is generally between 100 and 300 Hz?
    // Could be adjusted
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 100;
    highPassFilter.Q.value = 1;

    // Callback for when reader is finished
    reader.onload = () => {
        const arrayBuffer = reader.result;

        // Decode audio data from the audioBuffer
        audioCtx.decodeAudioData(arrayBuffer, (buffer) => {
            audioBufferSource.buffer = buffer;
            audioBufferSource.connect(analyser);
            analyser.connect(audioCtx.destination);
            audioBufferSource.loop = true;

            // Connect buffer to filter and get channel data
            lowPassSource.buffer = buffer;
            lowPassSource.connect(lowPassFilter);
            lowPassFilter.connect(highPassFilter);
            highPassFilter.connect(offlineCtx.destination);

            const sampleRate = audioBufferSource.buffer.sampleRate;

            // Start rendering the filtered buffer source
            lowPassSource.start(0);

            offlineCtx.startRendering().then((buffer) => {
                // buffer contains the output buffer
                const peaks = getPeaks([buffer.getChannelData(0), buffer.getChannelData(1)]);
                const groups = getIntervals(peaks);

                const top = groups.sort((intA, intB) => {
                    return intB.count - intA.count;
                }).splice(0, 5);

                const myTempo = top[0].tempo;

                analyze(audioBufferSource.buffer).then((tempo) => {
                    // the tempo could be analyzed
                    libTempo = Math.round(tempo);

                    // Set labels on completion
                    document.getElementById('my_guess').innerHTML =
                        'Our tempo guess: ' + myTempo;
                    document.getElementById('library_guess').innerHTML =
                        'Tempo from library: ' + libTempo;
                    document.getElementById('sample_rate').innerHTML =
                        'Sample rate: ' + sampleRate;
                    loadButton.innerHTML = '✓';

                    // Allow playing the music
                    loadButton.removeAttribute('disabled');
                    playButton.removeAttribute('disabled');
                    stopButton.removeAttribute('disabled');
                })
                .catch((err) => {
                    // something went wrong
                    console.log(err);
                });
            });
        }, (e) => {
            console.log("Error with decoding audio data" + e.err);
        });
    }

    // Async read the fileInput files as an array buffer
    reader.readAsArrayBuffer(file);
}

function getPeaks(data) {
    // Divide audio into individual parts.
    // For each part, get the loudest sample (with filtering it's probably a kick drum)
    // Each part is ~ 0.5 seconds long (22050 samples), gives 60 individual beats
    // Which we will further reduce down
    let partSize = 22050,
        parts = data[0].length / partSize,
        peaks = [];

    for (let i = 0; i < parts; i++) {
        let max = 0;
        for (let j = i * partSize; j < (i + 1) * partSize; j++) {
            // The volume at a given point is the maximum absolute value of the channels
            let volume = Math.max(Math.abs(data[0][j]), Math.abs(data[1][j]));
            if (!max || (volume > max.volume)) {
                // Change the max for this part if new
                max = {
                    position: j,
                    volume: volume
                };
            }
        }
        peaks.push(max);
    }

    // Sort by the volume we placed in
    peaks.sort((a, b) => {
      return b.volume - a.volume;
    });

    // Take the loudest 1/2 of peaks
    peaks = peaks.splice(0, peaks.length * 0.5);

    // Re sort by position
    peaks.sort((a, b) => {
      return a.position - b.position;
    });

    return peaks;
}

function getIntervals(peaks) {
  // Given a list of peaks, get the distance intervals between them
  // The most common interval (in time) can be used to guess a tempo
  // The tempo can be easily converted to a BPM

  const groups = [];

  peaks.forEach((peak, index) => {
    for (let i = 1; (index + i) < peaks.length && i < 10; i++) {
      let group = {
        tempo: (60 * 44100) / (peaks[index + i].position - peak.position),
        count: 1
      };

      // If the group's tempo is < 90 or > 180 it's probably wrong,
      // so we should adjust it accordingly
      while (group.tempo < 90) {
        group.tempo *= 2;
      }

      while (group.tempo > 180) {
        group.tempo /= 2;
      }

      group.tempo = Math.round(group.tempo);

      if (!(groups.some((interval) => {
        return (interval.tempo === group.tempo ? interval.count++ : 0);
      }))) {
        groups.push(group);
      }
    }
  });

  return groups;
}

function onBeat() {
    // Only change animations every so often
    if (!videoPlayer.src || Math.random() > 0.5) {
        let randSrcChoice = videoSources[Math.random() * videoSources.length | 0]
        videoPlayer.src = randSrcChoice;
    }

    videoPlayer.play(0);
    videoPlayer.currentTime = 0;
}

function draw() {
    const drawVisual = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = 'rgb(255, 255, 255)';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        const gradient = canvasCtx.createLinearGradient(0, canvas.height,
            0, canvas.height / 1.5);

        gradient.addColorStop(0, '#341677');
        gradient.addColorStop(0.5, '#a32f80')
        gradient.addColorStop(1, '#ff6363')

        // Draw a bar for this buffer with a nice color scheme :)
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight);

        x += barWidth + 1;
    }
}

function onSubmit(event) {
    event.preventDefault();

    loadButton.setAttribute('disabled', 'disabled');
    loadButton.innerHTML = '...';

    getAudioBuffer();
}

function onPlay(event) {
    event.preventDefault();
    playButton.setAttribute('disabled', 'disabled');

    let ms_timeout = 60000 / libTempo;

    analyser.fftSize = 512;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    // Clear, reset to white background
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    audioBufferSource.start(0);
    draw();
    runningInterval = setInterval(onBeat, ms_timeout);
}

function stopPlayback(event) {
    event.preventDefault();

    // Clear the looping animation interval
    clearInterval(runningInterval);

    videoPlayer.pause();
    videoPlayer.src = '';

    audioBufferSource.stop(0);
    playButton.removeAttribute('disabled');
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
}

form.addEventListener('submit', onSubmit);
stopButton.addEventListener('click', stopPlayback);
playButton.addEventListener('click', onPlay);
