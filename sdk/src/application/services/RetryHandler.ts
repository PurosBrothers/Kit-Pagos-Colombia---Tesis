export class RetryHandler {
    execute<T> (operation: () => Promise<T>) : Promise<T>{
        throw new Error("Aun no esta implementado");
    }
    isTransient(error: unknown) : boolean{
        throw new Error("aun no esta implementado");
    }

}
