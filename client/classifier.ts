export enum EiSerialSensor {
    EI_CLASSIFIER_SENSOR_UNKNOWN             = -1,
    EI_CLASSIFIER_SENSOR_MICROPHONE          = 1,
    EI_CLASSIFIER_SENSOR_ACCELEROMETER       = 2,
    EI_CLASSIFIER_SENSOR_CAMERA              = 3,
    EI_CLASSIFIER_SENSOR_9DOF                = 4,
    EI_CLASSIFIER_SENSOR_ENVIRONMENTAL       = 5,
}

export type ClassifierPropertiesSensor = 'accelerometer' | 'microphone' | 'camera' | 'positional';

export interface ClassifierProperties {
    sensor: ClassifierPropertiesSensor;
    frequency: number;
    inputFeaturesCount: number;
    imageInputWidth: number;
    imageInputHeight: number;
    imageInputFrames: number;
    imageInputChannelCount: number;
    intervalMs: number;
    axisCount: number;
    labelCount: number;
    modelType: 'classification' | 'object_detection' | 'constrained_object_detection';
    hasAnomaly: boolean;
}

export interface WasmRuntimeModule {
    HEAPU8: {
        buffer: Uint8Array;
    };
    onRuntimeInitialized: () => void;
    run_classifier(dataPointer: number, dataLength: number, debug: boolean): {
        result: number;
        anomaly: number;
        size(): number;
        get(index: number): {
            label: string;
            value: number;
            width?: number;
            height?: number;
            x?: number;
            y?: number;
            delete: () => void;
        };
    };
    get_properties(): {
        frequency: number;
        has_anomaly: boolean;
        input_features_count: number;
        image_input_width: number;
        image_input_height: number;
        image_input_frames: number;
        image_input_channel_count: number;
        interval_ms: number;
        axis_count: number;
        label_count: number;
        sensor: EiSerialSensor;
        model_type: 'classification' | 'object_detection' | 'constrained_object_detection';
    };
    get_project(): {
        id: number;
        owner: string;
        name: string;
        deploy_version: number;
    };
    _free(pointer: number): void;
    _malloc(bytes: number): number;
}

export type ClassificationResponse = {
    anomaly: number;
    results: { label: string; value: number; width?: number; height?: number; x?: number; y?: number }[];
};

export class EdgeImpulseClassifier {
    private _initialized = false;
    private _module: WasmRuntimeModule;

    constructor(module: WasmRuntimeModule) {
        this._module = module;
        this._module.onRuntimeInitialized = () => {
            this._initialized = true;
        };
    }

    init() {
        if (this._initialized === true) return Promise.resolve();

        return new Promise<void>((resolve) => {
            this._module.onRuntimeInitialized = () => {
                resolve();
                this._initialized = true;
            };
        });
    }

    getProperties(): ClassifierProperties {
        const ret = this._module.get_properties();

        let sensor: ClassifierPropertiesSensor;
        if (ret.sensor === EiSerialSensor.EI_CLASSIFIER_SENSOR_ACCELEROMETER) {
            sensor = "accelerometer";
        }
        else if (ret.sensor === EiSerialSensor.EI_CLASSIFIER_SENSOR_MICROPHONE) {
            sensor = "microphone";
        }
        else if (ret.sensor === EiSerialSensor.EI_CLASSIFIER_SENSOR_CAMERA) {
            sensor = "camera";
        }
        else if (ret.sensor === EiSerialSensor.EI_CLASSIFIER_SENSOR_9DOF) {
            sensor = "positional";
        }
        else {
            throw new Error('Unknown sensor (' + ret.sensor + ')');
        }

        return {
            sensor: sensor,
            frequency: ret.frequency,
            inputFeaturesCount: ret.input_features_count,
            imageInputWidth: ret.image_input_width,
            imageInputHeight: ret.image_input_height,
            imageInputFrames: ret.image_input_frames,
            imageInputChannelCount: ret.image_input_channel_count,
            intervalMs: ret.interval_ms,
            axisCount: ret.axis_count,
            labelCount: ret.label_count,
            modelType: ret.model_type,
            hasAnomaly: ret.has_anomaly,
        };
    }

    getProject() {
        return this._module.get_project();
    }

    classify(rawData: number[], debug = false): ClassificationResponse {
        if (!this._initialized) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);

        const ret = this._module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);

        this._module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        const jsResult: ClassificationResponse = {
            anomaly: ret.anomaly,
            results: []
        };

        for (let cx = 0; cx < ret.size(); cx++) {
            let c = ret.get(cx);
            jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
            c.delete();
        }

        return jsResult;
    }

    private _arrayToHeap(data: number[]) {
        const typedArray = new Float32Array(data);
        const numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        const ptr = this._module._malloc(numBytes);
        const heapBytes = new Uint8Array(this._module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }
}
