export class RetryHandler {
    async execute<T> (operation: () => Promise<T>) : Promise<T>{
        throw new Error("aun no esta implementado");
    }
    isTransient(error: unknown) : boolean{
        throw new Error("aun no esta implementado");
    }

}
