// The team's existing autos (team2844simple/autos/routines + geometries) rebuilt as
// ValleyVis projects, so the visualizer can be checked against code that already runs.

import { defaultZones } from './defaults.js';

const piecewiseHold = (a, b) => ({
  mode: 'piecewise',
  pieces: [
    { until: a, mode: 'constant', hold: 'start' },
    { until: b, mode: 'linear', from: 'start', to: 'end' },
    { until: 1, mode: 'constant', hold: 'end' },
  ],
});

const shoot = (ms) => ({ lib: 'shoot', params: { timeoutMs: ms } });
const intakeTransfer = () => ({ lib: 'intakeTransfer', params: {} });

function upRoutine() {
  return {
    version: 1,
    name: 'Up (from UpRoutine)',
    className: 'UpVisRoutine',
    opModeName: 'Vis Up',
    blueTarget: 'Constants.BACK_SIDE',
    redTarget: 'Constants.AUDIENCE_SIDE',
    start: { name: 'start', x: '72+L/2', y: '144-W/2', h: -90 },
    steps: [
      { id: 'u1', type: 'action', label: 'Shoot preloaded', cmds: [shoot(4000)], timeout: null },
      {
        id: 'u2', type: 'path', name: 'toGarden', endName: 'intakeFromGarden',
        segments: [{ type: 'curve', controls: [{ x: 108, y: 120 }], end: { x: '144-L/2', y: '144-W/2' } }],
        endH: 0,
        heading: {
          mode: 'piecewise',
          pieces: [
            { until: 0.2, mode: 'constant', hold: 'start' },
            { until: 0.8, mode: 'linear', from: 'start', to: 'end' },
            { until: 1, mode: 'constant', hold: 'end' },
          ],
        },
        maxSpeed: null, timeout: null, during: [intakeTransfer()], markers: [],
      },
      {
        id: 'u3', type: 'path', name: 'readyShoot1', endName: 'readyToShoot',
        segments: [{ type: 'line', controls: [], end: { x: 96, y: 108 } }],
        endH: -90, heading: piecewiseHold(0.2, 0.8),
        maxSpeed: null, timeout: null, during: [], markers: [],
      },
      { id: 'u4', type: 'action', label: 'Spin up', cmds: [{ lib: 'spinUp', params: {} }], timeout: null },
      { id: 'u5', type: 'wait', seconds: 0 },
      { id: 'u6', type: 'action', label: 'Shoot', cmds: [shoot(4000)], timeout: null },
    ],
    zones: defaultZones(),
  };
}

function downRoutine() {
  return {
    version: 1,
    name: 'Down (from DownRoutine)',
    className: 'DownVisRoutine',
    opModeName: 'Vis Down',
    blueTarget: 'Constants.AUDIENCE_SIDE',
    redTarget: 'Constants.BACK_SIDE',
    start: { name: 'start', x: '72+W/2', y: 'L/2', h: 90 },
    steps: [
      { id: 'd1', type: 'action', label: 'Spin up', cmds: [{ lib: 'spinUp', params: {} }], timeout: null },
      { id: 'd2', type: 'wait', seconds: 15 },
      { id: 'd3', type: 'action', label: 'Shoot', cmds: [shoot(8000)], timeout: null },
    ],
    zones: defaultZones(),
  };
}

function soloRoutine() {
  return {
    version: 1,
    name: 'Solo (from SoloRoutine)',
    className: 'SoloVisRoutine',
    opModeName: 'Vis Solo',
    blueTarget: 'Constants.BACK_SIDE',
    redTarget: 'Constants.AUDIENCE_SIDE',
    start: { name: 'start', x: '72+L/2', y: '144-W/2', h: -90 },
    steps: [
      { id: 's1', type: 'action', label: 'Shoot preloaded', cmds: [shoot(4000)], timeout: null },
      {
        id: 's2', type: 'path', name: 'toGarden', endName: 'intakeFromGarden',
        segments: [{ type: 'line', controls: [], end: { x: '144-L/2', y: '144-W/2' } }],
        endH: 0, heading: { mode: 'linear', endT: 1, long: false },
        maxSpeed: null, timeout: null, during: [intakeTransfer()], markers: [],
      },
      {
        id: 's3', type: 'path', name: 'underpassFromGarden', endName: 'flippedShoot',
        segments: [
          { type: 'curve', controls: [{ x: 82, y: 137 }], end: { x: 82, y: 112 } },
          { type: 'curve', controls: [{ x: 82, y: 107 }], end: { x: 82, y: 24 } },
        ],
        endH: 90, heading: piecewiseHold(0.2, 0.8),
        maxSpeed: null, timeout: null, during: [], markers: [],
      },
      { id: 's4', type: 'action', label: 'Switch side', cmds: [{ lib: 'switchSide', params: {} }], timeout: null },
      { id: 's5', type: 'action', label: 'Shoot', cmds: [shoot(4000)], timeout: null },
    ],
    zones: defaultZones(),
  };
}

export const PRESETS = [
  { id: 'up', label: 'Up routine (team code)', make: upRoutine },
  { id: 'solo', label: 'Solo routine (team code)', make: soloRoutine },
  { id: 'down', label: 'Down routine (team code)', make: downRoutine },
];
