// Camera access: start, stop, switch, and readable errors.
export class Camera {
  constructor(video) { this.video = video; this.stream = null; this.deviceId = null; this.mirror = true }

  async start(deviceId) {
    this.stop()
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
    const v = { width: { ideal: 1280 }, height: { ideal: 720 } }
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = 'user'
    this.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false })
    const s = this.stream.getVideoTracks()[0].getSettings()
    this.deviceId = s.deviceId || null
    this.mirror = s.facingMode !== 'environment' // selfie cameras are shown mirrored
    this.video.srcObject = this.stream
    await this.video.play()
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
  }

  get active() { return !!this.stream }

  async cameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput') } catch { return [] }
  }

  async switch() {
    const list = await this.cameras()
    if (list.length < 2) throw Object.assign(new Error('one camera'), { name: 'OneCameraError' })
    const i = list.findIndex((d) => d.deviceId === this.deviceId)
    await this.start(list[(i + 1) % list.length].deviceId)
  }
}

export function describeError(e) {
  switch (e && e.name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      return 'Camera permission was blocked. Click the camera icon in your browser address bar, choose Allow, then press Start Camera.'
    case 'NotFoundError': case 'DevicesNotFoundError': return 'No camera was found on this device.'
    case 'NotReadableError': case 'TrackStartError': return 'The camera is being used by another app. Close it and try again.'
    case 'OverconstrainedError': return 'That camera is not available. Try Switch Camera.'
    case 'SecurityError': return 'Camera needs a secure page (https or localhost).'
    case 'NotSupportedError': return 'This browser does not support camera access. Try Chrome, Edge, Safari or Firefox.'
    case 'OneCameraError': return 'Only one camera was found on this device.'
    default: return 'Could not start the camera. ' + (e && e.message ? e.message : '')
  }
}
