import { ClassificationClientViews } from "./classification-views";
import { getIngestionApi, storeIngestionApi, getRemoteManagementEndpoint,
    storeRemoteManagementEndpoint, storeStudioEndpoint, getStudioEndpoint } from "./settings";
import { MicrophoneDataCollectionClientViews } from "./microphone-collection-views";

export default async function mobileClientLoader(mode:
    'classifier' ) {

    storeIngestionApi(getIngestionApi());
    storeRemoteManagementEndpoint(getRemoteManagementEndpoint());
    storeStudioEndpoint(getStudioEndpoint());

    if (mode === 'classifier') {
        let client = new ClassificationClientViews();
        await client.init();
        (window as any).client = client;
    }

    // tslint:disable-next-line:no-console
    console.log('Hello world from the Edge Impulse mobile client', mode);
}
