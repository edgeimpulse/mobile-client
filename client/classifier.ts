export enum EiSerialSensor {
    EI_CLASSIFIER_SENSOR_UNKNOWN             = -1,
    EI_CLASSIFIER_SENSOR_MICROPHONE          = 1,
    EI_CLASSIFIER_SENSOR_ACCELEROMETER       = 2,
    EI_CLASSIFIER_SENSOR_CAMERA              = 3,
    EI_CLASSIFIER_SENSOR_9DOF                = 4,
    EI_CLASSIFIER_SENSOR_ENVIRONMENTAL       = 5,
}

export type ClassifierPropertiesSensor = 'accelerometer' | 'microphone' | 'camera' | 'positional';

export type ClassifierThresholds = ({
    id: number,
    type: 'anomaly_gmm',
    min_anomaly_score: number,
} | {
    id: number,
    type: 'object_detection',
    min_score: number,
} | {
    id: number,
    type: 'object_tracking',
    keep_grace: number,
    max_observations: number,
    threshold: number,
})[];

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
    hasObjectTracking: boolean;
    hasVisualAnomalyDetection: boolean;
    continuousMode: {
        sliceSize: number;
    } | undefined;
    isPerformanceCalibrationEnabled: boolean;
    classificationThreshold: number;
    thresholds: ClassifierThresholds | undefined,
}

export type WasmRunClassifierResponse = {
    result: number;
    anomaly: number;
    delete(): void;
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
    visual_ad_max: number | undefined;
    visual_ad_mean: number | undefined;
    visual_ad_grid_cells_size(): number;
    visual_ad_grid_cells_get(index: number): {
        label: string;
        value: number;
        width?: number;
        height?: number;
        x?: number;
        y?: number;
        delete: () => void;
    };
    object_tracking_size(): number;
    object_tracking_get(index: number): {
        object_id: number;
        label: string;
        value: number;
        width: number;
        height: number;
        x: number;
        y: number;
        delete: () => void;
    }
};

export interface WasmRuntimeModule {
    HEAPU8: {
        buffer: Uint8Array;
    };
    onRuntimeInitialized: () => void;
    init: () => void;
    run_classifier(dataPointer: number, dataLength: number, debug: boolean): WasmRunClassifierResponse;
    run_classifier_continuous(
        dataPointer: number, dataLength: number, debug: boolean, enablePerfCal: boolean): WasmRunClassifierResponse;
    get_properties(): {
        frequency: number;
        has_anomaly: boolean;
        has_object_tracking: boolean | undefined;
        has_visual_anomaly_detection: boolean;
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
        slice_size: number;
        use_continuous_mode: boolean | undefined;
        is_performance_calibration_enabled: boolean | undefined;
        classification_threshold: number;
        thresholds: ClassifierThresholds | undefined,
    };
    get_project(): {
        id: number;
        owner: string;
        name: string;
        deploy_version: number;
        impulse_id: number | undefined;
        impulse_name: string | undefined;
    };
    set_threshold(opts: {
        id: number,
    } & { [ k: string ]: number | boolean }): {
        success: true,
    } | {
        success: false,
        error: string,
    },
    _free(pointer: number): void;
    _malloc(bytes: number): number;
}

export type ClassificationResponse = {
    anomaly: number;
    results: { label: string; value: number; width?: number; height?: number; x?: number; y?: number }[];
    visual_ad_grid_cells: { label: string; value: number; width?: number; height?: number; x?: number; y?: number }[];
    has_visual_anomaly_detection: boolean;
    visual_ad_max?: number,
    visual_ad_mean?: number,
    object_tracking_results?: {
        object_id: number,
        label: string,
        width: number,
        height: number,
        x: number,
        y: number,
    }[],
};

export class EdgeImpulseClassifier {
    private _initialized = false;
    private _module: WasmRuntimeModule;
    private _props: ClassifierProperties | undefined;

    constructor(module: WasmRuntimeModule) {
        this._module = module;
        this._module.onRuntimeInitialized = () => {
            this._module.init();
            this._props = this.getProperties();
            this._initialized = true;
        };
    }

    init() {
        if (this._initialized === true) return Promise.resolve();

        return new Promise<void>((resolve) => {
            this._module.onRuntimeInitialized = () => {
                this._module.init();
                this._props = this.getProperties();
                this._initialized = true;
                resolve();
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
            hasVisualAnomalyDetection: ret.has_visual_anomaly_detection,
            continuousMode: ret.use_continuous_mode && ret.slice_size ? {
                sliceSize: ret.slice_size
            } : undefined,
            isPerformanceCalibrationEnabled: ret.is_performance_calibration_enabled || false,
            classificationThreshold: typeof ret.classification_threshold === 'number'
                ? ret.classification_threshold
                : 0.8,
            hasObjectTracking: ret.has_object_tracking || false,
            thresholds: ret.thresholds,
        };
    }

    getProject() {
        const project = this._module.get_project();
        return {
            id: project.id,
            owner: project.owner,
            name: project.name,
            deploy_version: project.deploy_version,
            impulse_id: project.impulse_id,
            impulse_name: project.impulse_name,
        };
    }

    classify(rawData: number[], debug = false): ClassificationResponse {
        if (!this._initialized || !this._props) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);

        const ret = this._module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);

        this._module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }

    classifyContinuous(rawData: number[], debug = false, enablePerfCal = true): ClassificationResponse {
        if (!this._initialized || !this._props) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);

        const ret = this._module.run_classifier_continuous(obj.buffer.byteOffset, rawData.length, debug, enablePerfCal);

        this._module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }

    /**
     * Override the threshold on a learn block (you can find thresholds via getProperties().thresholds)
     * @param {*} obj, e.g. { id: 16, min_score: 0.2 } to set min. object detection threshold to 0.2 for block ID 16
     */
    setThreshold(obj: { id: number } & { [ k: string ]: number | boolean }) {
        const ret = this._module.set_threshold(obj);
        if (!ret.success) {
            throw new Error(ret.error);
        }
    }

    private _arrayToHeap(data: number[]) {
        const typedArray = new Float32Array(data);
        const numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        const ptr = this._module._malloc(numBytes);
        const heapBytes = new Uint8Array(this._module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }

    private _fillResultStruct(ret: WasmRunClassifierResponse) {
        if (!this._initialized || !this._props) throw new Error('Module is not initialized');

        let jsResult: ClassificationResponse = {
            anomaly: ret.anomaly,
            results: [],
            visual_ad_grid_cells: [],
            has_visual_anomaly_detection: this._props.hasVisualAnomalyDetection,
        };

        for (let cx = 0; cx < ret.size(); cx++) {
            let c = ret.get(cx);
            if (this._props.modelType === 'object_detection' || this._props.modelType === 'constrained_object_detection') {
                jsResult.results.push({
                    label: c.label,
                    value: c.value,
                    x: c.x,
                    y: c.y,
                    width: c.width,
                    height: c.height
                });
            }
            else {
                jsResult.results.push({
                    label: c.label,
                    value: c.value
                });
            }
            c.delete();
        }

        if (this._props.hasObjectTracking) {
            jsResult.object_tracking_results = [];
            for (let cx = 0; cx < ret.object_tracking_size(); cx++) {
                let c = ret.object_tracking_get(cx);
                jsResult.object_tracking_results.push({
                    object_id: c.object_id,
                    label: c.label,
                    x: c.x,
                    y: c.y,
                    width: c.width,
                    height: c.height
                });
                c.delete();
            }
        }

        if (this._props.hasVisualAnomalyDetection) {
            jsResult.visual_ad_max = ret.visual_ad_max;
            jsResult.visual_ad_mean = ret.visual_ad_mean;
            jsResult.visual_ad_grid_cells = [];
            for (let cx = 0; cx < ret.visual_ad_grid_cells_size(); cx++) {
                let c = ret.visual_ad_grid_cells_get(cx);
                jsResult.visual_ad_grid_cells.push({
                    label: c.label,
                    value: c.value,
                    x: c.x,
                    y: c.y,
                    width: c.width,
                    height: c.height
                });
                c.delete();
            }
        }

        ret.delete();

        return jsResult;
    }
}
