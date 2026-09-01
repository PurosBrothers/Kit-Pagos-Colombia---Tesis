export class RetryHandler {
    async execute<T> (_operation: () => Promise<T>) : Promise<T>{
        throw new Error("aun no esta implementado");
    }
    isTransient(_error: unknown) : boolean{
        throw new Error("aun no esta implementado");
    }

}
