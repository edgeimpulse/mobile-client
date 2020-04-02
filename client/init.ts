import { DataCollectionClientViews } from "./collection-views";
import { ClassificationClientViews } from "./classification-views";

export default function mobileClientLoader(mode: 'data-collection' | 'classifier') {
    if (mode === 'data-collection') {
        (window as any).client = new DataCollectionClientViews();
    }
    else if (mode === 'classifier') {
        (window as any).client = new ClassificationClientViews();
    }

    // tslint:disable-next-line:no-console
    console.log('Hello world from the Edge Impulse mobile client', mode);
}
