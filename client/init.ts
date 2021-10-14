import { DataCollectionClientViews } from "./collection-views";
import { ClassificationClientViews } from "./classification-views";
import { getIngestionApi, storeIngestionApi, getRemoteManagementEndpoint,
    storeRemoteManagementEndpoint, storeStudioEndpoint, getStudioEndpoint } from "./settings";
import { CameraDataCollectionClientViews } from "./camera-collection-views";
import { DataCollectionKeywordClientViews } from "./collection-keyword";
import { TimeSeriesDataCollectionClientViews } from "./time-series-collection-views";

export default async function mobileClientLoader(mode:
    'data-collection' | 'classifier' | 'data-collection-camera' | 'data-collection-keyword' |
    'data-collection-microphone' | 'data-collection-accelerometer') {

    storeIngestionApi(getIngestionApi());
    storeRemoteManagementEndpoint(getRemoteManagementEndpoint());
    storeStudioEndpoint(getStudioEndpoint());

    if (mode === 'data-collection') {
        let client = new DataCollectionClientViews();
        await client.init();
        (window as any).client = client;

    }
    else if (mode === 'classifier') {
        let client = new ClassificationClientViews();
        await client.init();
        (window as any).client = client;
    }
    else if (mode === 'data-collection-camera') {
        let client = new CameraDataCollectionClientViews();
        await client.init();
        (window as any).client = client;
    }
    else if (mode === 'data-collection-microphone') {
        let client = new TimeSeriesDataCollectionClientViews();
        await client.init('microphone');
        (window as any).client = client;
    }
    else if (mode === 'data-collection-accelerometer') {
        let client = new TimeSeriesDataCollectionClientViews();
        await client.init('accelerometer');
        (window as any).client = client;
    }
    else if (mode === 'data-collection-keyword') {
        let client = new DataCollectionKeywordClientViews();
        await client.init();
        (window as any).client = client;
    }

    // tslint:disable-next-line:no-console
    console.log('Hello world from the Edge Impulse mobile client', mode);
}
