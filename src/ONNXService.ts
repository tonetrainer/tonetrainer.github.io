export interface InferenceFeeds {
  tokens: number[];
  tones: number[];
  speakers: number;
}

export class ONNXService {
  private worker: Worker | null = null;
  private modelLoaded: boolean = false;
  private _modelFileName: string;
  private requestQueue: {
    feeds: InferenceFeeds;
    resolve: (result: Float32Array) => void;
    reject: (error: Error) => void;
  }[] = [];
  private processingRequest: boolean = false;

  constructor(modelFileName: string) {
    this._modelFileName = modelFileName;
  }

  // Getter for modelFileName
  get modelFileName(): string {
    return this._modelFileName;
  }

  async initializeSession(): Promise<void> {
    if (this.worker) return; // Avoid re-initializing if the worker already exists

    this.worker = new Worker("/onnx-worker.js");
    this.worker.onmessage = this.handleWorkerMessages.bind(this);

    const modelPath = `${window.location.origin}/${this._modelFileName}`;

    return new Promise<void>((resolve, reject) => {
      this.worker!.postMessage({ type: "loadModel", modelPath });

      const checkModelLoaded = setInterval(() => {
        if (this.modelLoaded) {
          clearInterval(checkModelLoaded);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkModelLoaded);
        reject(new Error("Model loading timed out"));
      }, 50000);
    });
  }

  async runInference(feeds: InferenceFeeds): Promise<Float32Array> {
    if (!this.worker) throw new Error("Worker is not initialized");

    return new Promise<Float32Array>((resolve, reject) => {
      this.requestQueue.push({ feeds, resolve, reject });
      this.processNextRequest();
    });
  }

  private processNextRequest() {
    if (this.processingRequest || this.requestQueue.length === 0) return;

    this.processingRequest = true;
    const { feeds, resolve, reject } = this.requestQueue.shift()!;

    this.worker!.postMessage({ type: "run", feeds });

    this.worker!.onmessage = (e: MessageEvent) => {
      const { type, status, error, result } = e.data;

      if (type === "run") {
        if (status === "success") {
          resolve(result as Float32Array);
        } else {
          reject(new Error(error));
        }

        this.processingRequest = false;
        this.processNextRequest();
      }
    };
  }

  terminateWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.modelLoaded = false;
    }
  }

  private handleWorkerMessages(e: MessageEvent) {
    const { type, status, error } = e.data;

    if (type === "loadModel") {
      if (status === "success") {
        this.modelLoaded = true;
      } else {
        console.error("Error loading model in Web Worker:", error);
      }
    }
  }
}
