import { getAuth, getDeviceId, storeApiKeyAndImpulseId, storeDeviceId } from "./settings";
import { RemoteManagementConnection } from "./remote-mgmt";
import { ISensor } from "./sensors/isensor";
import { CameraSensor } from "./sensors/camera";
import html from './escape-html-template-tag';

export class DataCollectionContinuousCameraClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        connected: document.querySelector('#remote-mgmt-connected') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        permission: document.querySelector('#permission-view') as HTMLElement,
        capture: document.querySelector('#capture-camera') as HTMLElement,
        completedSampleCollection: document.querySelector('#completed-sample-collection') as HTMLElement,
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        samplingLabel: document.querySelector('#sampling-label') as HTMLElement,
        completedSamplingLabel: document.querySelector('#completed-sampling-label') as HTMLElement,
        collectedSampleCount: document.querySelector('#collected-sample-count') as HTMLElement,
        targetSampleCount: document.querySelector('#target-sample-count') as HTMLElement,
        samplingCaptureQtyLeft: document.querySelector('#sampling-capture-qty-left') as HTMLElement,
        samplingCaptureBtn: document.querySelector('#capture-camera-button') as HTMLButtonElement,
        samplingCaptureBtnCaptureMode: document.querySelector('#capture-camera-button #capture-mode') as HTMLElement,
        samplingCaptureBtnUploadingMode: document.querySelector('#capture-camera-button #uploading-mode') as HTMLElement,
        grantPermissionsBtn: document.querySelector('#grant-permissions-button') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
    };

    private _cameraSensor: ISensor | null = null;
    private _permissionTimeout: number | undefined;
    private _idleTimeout: number | undefined;

    async init() {
        storeDeviceId(getDeviceId());


        const camera = new CameraSensor();
        if (await camera.hasSensor()) {
            console.log('has camera');
            this._cameraSensor = camera;
        }

        const auth = getAuth();

        if (auth?.auth !== 'apiKey') {
            throw new Error('No API key provided');
        }

        this.switchView(this._views.loading);
        this._elements.loadingText.textContent = 'Connecting to Edge Impulse...';

        const connection = new RemoteManagementConnection({
            apiKey: auth.apiKey,
            device: {
                deviceId: getDeviceId(),
                sensors: this._cameraSensor ? [ this._cameraSensor.getProperties() ] : [],
                deviceType: 'MOBILE_CLIENT'
            }
        }, this.beforeSampling.bind(this));

        connection.on('connected', () => {
            // persist keys now...
            storeApiKeyAndImpulseId(auth.apiKey, auth.impulseId);
            window.history.replaceState(null, '', window.location.pathname);

            this._elements.deviceId.textContent = getDeviceId();
            this.switchView(this._views.connected);
        });

        connection.on('error', err => {
            console.error('Connection failed', err);
            this._elements.connectionFailedMessage.textContent = err;
            this.switchView(this._views.connectionFailed);
        });

        connection.on('samplingStarted', ({label, labelColor, collectedSampleCount, targetSampleCount}) => {
            clearTimeout(this._idleTimeout);

            this._elements.samplingCaptureBtn.disabled = false;
            this._elements.samplingCaptureBtnUploadingMode.classList.add('d-none');
            this._elements.samplingCaptureBtnCaptureMode.classList.remove('d-none');

            this._elements.samplingLabel.textContent = label ?? '';
            this._elements.samplingLabel.style.color = html`${labelColor ?? 'inherit'}`.toString();
            this._elements.samplingLabel.dataset.hasCustomColor = labelColor ? '1' : '0';

            if (typeof collectedSampleCount === 'number' && typeof targetSampleCount === 'number') {
                const remainingSamples = Math.max(0, targetSampleCount - collectedSampleCount);
                this._elements.samplingCaptureQtyLeft.textContent = `Collect ${remainingSamples} more`;
            }
        });
        connection.on('samplingUploading', () => {
            this._elements.samplingCaptureBtn.disabled = true;
            this._elements.samplingCaptureBtnUploadingMode.classList.remove('d-none');
            this._elements.samplingCaptureBtnCaptureMode.classList.add('d-none');
        });
        connection.on('samplingFinished', ({label, labelColor, collectedSampleCount, targetSampleCount}) => {
            clearTimeout(this._idleTimeout);

            this._elements.samplingCaptureBtn.disabled = false;
            this._elements.samplingCaptureBtnUploadingMode.classList.add('d-none');
            this._elements.samplingCaptureBtnCaptureMode.classList.remove('d-none');

            if (typeof collectedSampleCount === 'number' && typeof targetSampleCount === 'number') {
                // collectedSampleCount was calculated during the request phase. After the
                // sample upload  is complete, then we increment the count by 1 to account
                // for the sample that was just uploaded.
                collectedSampleCount++;

                // Show the completed view when the target sample count is reached
                if (collectedSampleCount >= targetSampleCount) {
                    this.switchView(this._views.completedSampleCollection);

                    this._elements.completedSamplingLabel.textContent = label ?? '';
                    this._elements.completedSamplingLabel.style.color = html`${labelColor ?? 'inherit'}`.toString();
                    this._elements.completedSamplingLabel.dataset.hasCustomColor = labelColor ? '1' : '0';

                    this._elements.collectedSampleCount.textContent = collectedSampleCount.toString();
                    this._elements.targetSampleCount.textContent = targetSampleCount.toString();
                }
                else {
                    // If the user minimizes the CV tutorial or closes Studio, then the next sampling
                    // request is not sent, in which case we should return to the connected view after
                    // a 2 second grace period
                    this._idleTimeout = setTimeout(() => this.switchView(this._views.connected), 2000);
                }
            }
            else {
                this.switchView(this._views.connected);
            }

        });
        connection.on('samplingError', error => {
            alert(error);
        });
    }

    private switchView(view: HTMLElement) {
        for (const k of Object.keys(this._views)) {
            (<{ [k: string]: HTMLElement }>this._views)[k].style.display = 'none';
        }
        view.style.display = '';

        if (view !== this._views.capture) {
            // Stop reading the camera sensor stream on non-capture views. This is important
            // to remove the active recording privacy indicator in browser and OS UIs
            if (this._cameraSensor && typeof this._cameraSensor.release === 'function') {
                this._cameraSensor.release();
            }
        }
    }

    private async beforeSampling(): Promise<ISensor> {
        clearTimeout(this._permissionTimeout);

        if (!this._cameraSensor) {
            throw new Error('Camera sensor is not available');
        }

        if (await this._cameraSensor.checkPermissions(false)) {
            this.switchView(this._views.capture);
            return this._cameraSensor;
        }
        else {
            this.switchView(this._views.permission);

            return new Promise<ISensor>((resolve, reject) => {
                this._permissionTimeout = setTimeout(() => {
                    reject('User did not grant permissions within one minute');
                }, 60 * 1000);

                this._elements.grantPermissionsBtn.onclick = () => {
                    if (!this._cameraSensor) return reject('Camera sensor is missing');

                    this._cameraSensor.checkPermissions(true).then((result) => {
                        if (!this._cameraSensor) {
                            return reject('Camera sensor is missing');
                        }

                        if (result) {
                            this.switchView(this._views.capture);
                            resolve(this._cameraSensor);
                        }
                        else {
                            reject('User has rejected camera permissions');
                        }
                    }).catch(reject);

                    clearTimeout(this._permissionTimeout);
                };
            });
        }
    }
}