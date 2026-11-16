// Defaults seeded from Team2844_Season2026/team2844simple (Constants.java, PedroConstants.java,
// commands/, AutoBase.java). Everything here is editable on the Settings page.

export const SETTINGS_VERSION = 1;

const TEAM = 'org.firstinspires.ftc.team2844simple';

export const DEFAULT_COMMANDS = [
  {
    id: 'shoot', name: 'Shoot', type: 'command', color: '#ef4444',
    java: 'new ShootCmd(subsystems.intake, subsystems.pollen, subsystems.transfer, {timeoutMs})',
    params: [{ key: 'timeoutMs', label: 'Timeout (ms)', default: 4000 }],
    duration: 'timeoutMs / 1000',
    requires: 'intake, pollen, transfer',
    imports: `${TEAM}.commands.shoot.ShootCmd`,
  },
  {
    id: 'intakeTransfer', name: 'Intake + transfer', type: 'command', color: '#3b82f6',
    java: 'CommandFactory.intakeAndTransfer(subsystems.intake, subsystems.transfer)',
    params: [],
    duration: 'forever',
    requires: 'intake, transfer',
    imports: `${TEAM}.commands.CommandFactory`,
  },
  {
    id: 'intake', name: 'Intake', type: 'command', color: '#60a5fa',
    java: 'new IntakeCmd(subsystems.intake, {speed})',
    params: [{ key: 'speed', label: 'Speed', default: 1.0 }],
    duration: 'forever',
    requires: 'intake',
    imports: `${TEAM}.commands.intake.IntakeCmd`,
  },
  {
    id: 'transfer', name: 'Transfer', type: 'command', color: '#93c5fd',
    java: 'new TransferCmd(subsystems.transfer, {speed})',
    params: [{ key: 'speed', label: 'Speed', default: 0.6 }],
    duration: 'forever',
    requires: 'transfer',
    imports: `${TEAM}.commands.transfer.TransferCmd`,
  },
  {
    id: 'spinUp', name: 'Spin up shooter', type: 'instant', color: '#f97316',
    java: 'subsystems.pollen.shoot();', params: [], duration: '0', requires: '', imports: '',
  },
  {
    id: 'idleShooter', name: 'Idle shooter', type: 'instant', color: '#fb923c',
    java: 'subsystems.pollen.idleShoot();', params: [], duration: '0', requires: '', imports: '',
  },
  {
    id: 'stopIntake', name: 'Stop intake', type: 'instant', color: '#64748b',
    java: 'subsystems.intake.stopIntake();', params: [], duration: '0', requires: '', imports: '',
  },
  {
    id: 'stopTransfer', name: 'Stop transfer', type: 'instant', color: '#64748b',
    java: 'subsystems.transfer.stop();', params: [], duration: '0', requires: '', imports: '',
  },
  {
    id: 'openGates', name: 'Open gates', type: 'instant', color: '#a3e635',
    java: 'subsystems.transfer.openGates();', params: [], duration: '0', requires: '', imports: '',
  },
  {
    id: 'closeGates', name: 'Close gates', type: 'instant', color: '#84cc16',
    java: 'subsystems.transfer.closeGates();', params: [], duration: '0', requires: '', imports: '',
  },
  {
    id: 'switchSide', name: 'Switch target side', type: 'instant', color: '#a855f7',
    java: 'Constants.changeSide((Constants.side == Constants.AUDIENCE_SIDE) ? Constants.BACK_SIDE : Constants.AUDIENCE_SIDE);',
    params: [], duration: '0', requires: '',
    imports: `${TEAM}.helpers.Constants`,
  },
  {
    id: 'holdPosition', name: 'Hold position', type: 'command', color: '#14b8a6',
    java: 'new HoldPosition(subsystems.drive)',
    params: [], duration: 'forever', requires: 'drive',
    imports: `${TEAM}.commands.drive.HoldPosition`,
  },
];

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  robot: {
    length: 15.875, // front-to-back, along the heading (Constants.ROBOT_LENGTH)
    width: 15.875, // side-to-side (Constants.ROBOT_WIDTH)
    lengthJava: 'Constants.ROBOT_LENGTH',
    widthJava: 'Constants.ROBOT_WIDTH',
  },
  motion: {
    // PedroConstants: maxAchievableForwardVelocity / maxAchievableStrafeVelocity (in/s).
    // Pedro's mecanum model blends them by drive direction: 1 / (|cos|/forward + |sin|/strafe).
    maxVelForward: 74.45,
    maxVelStrafe: 58.21,
    accel: 60, // in/s^2
    decel: 45, // in/s^2
    lateralAccel: 70, // in/s^2, caps speed through curves (v <= sqrt(a/curvature))
    turnRate: 220, // deg/s for in-place turns and heading changes
    settle: 0.25, // s spent settling at the end of a follow / turn
  },
  match: {
    routineTimeout: 20, // AutoBase: routine().withTimeout(20.0)
    parkTimeout: 9.75, // AutoBase: GoToCmd(routeToPark).withTimeout(9.75)
    autoLength: 30,
    enforceTimeout: true, // cut the routine at routineTimeout during playback, like AutoBase
    showPark: true,
    wallTolerance: 0.5, // in the robot may poke past a wall before it's flagged
  },
  field: {
    image: 'assets/field-biobuzz.webp',
    customImage: null, // data URL from the Settings page
    customImagePlusX: 'up', // where +x points in the custom image
    plusX: 'up', // where +x points on screen (the bundled image is drawn for 'up')
    opacity: 1,
    grid: false,
    snap: 0.5,
  },
  alliance: {
    redTransform: 'point', // AutoPaths.RED = PoseFactory.degrees().mirrorX(72).mirrorY(72)
  },
  constants: [
    // extra named numbers usable in any coordinate field, e.g. { name: 'MID_X', value: 82, java: 'MID_X' }
  ],
  points: [
    // design-frame (blue) points drawn on the field and usable as facing targets
    { name: 'Blue audience cell', x: 84, y: 66 },
    { name: 'Blue back cell', x: 84, y: 78 },
  ],
  code: {
    routinePackage: `${TEAM}.autos.routines`,
    bluePackage: `${TEAM}.autos.blue`,
    redPackage: `${TEAM}.autos.red`,
    baseClass: 'AutoBase',
    baseImport: `${TEAM}.autos.AutoBase`,
    constantsImport: `${TEAM}.helpers.Constants`,
    drive: 'subsystems.drive',
    poseFactory: 'field()',
    turnTemplate: 'new TurnToCmd({drive}, {heading})',
    turnImports: `${TEAM}.commands.drive.TurnToCmd`,
    blueAlliance: 'Constants.BLUE_ALLIANCE',
    redAlliance: 'Constants.RED_ALLIANCE',
  },
  commands: DEFAULT_COMMANDS,
};

/** Floor-level field obstacles in the Pedro frame (blue design frame). */
export function defaultZones() {
  // HIVE frame: 49.46 in wide x 38.95 in deep at the base, centred on the field.
  // Its two triangular end frames stand on the tiles at x ~ 47.3 and x ~ 96.7.
  return [
    { id: 'hive-leg-audience', name: 'Hive frame leg (x≈48)', shape: 'rect', x: 47.3, y: 52.5, w: 1.5, h: 39, clearance: 2, enabled: true, mirror: false },
    { id: 'hive-leg-back', name: 'Hive frame leg (x≈96)', shape: 'rect', x: 95.2, y: 52.5, w: 1.5, h: 39, clearance: 2, enabled: true, mirror: false },
  ];
}

export function emptyProject() {
  return {
    version: 1,
    name: 'New Auto',
    className: 'NewAutoRoutine',
    opModeName: 'New Auto',
    blueTarget: 'Constants.BACK_SIDE',
    redTarget: 'Constants.AUDIENCE_SIDE',
    start: { name: 'start', x: '72+L/2', y: '144-W/2', h: -90 },
    steps: [],
    zones: defaultZones(),
  };
}

export function cloneDeep(v) {
  return JSON.parse(JSON.stringify(v));
}
