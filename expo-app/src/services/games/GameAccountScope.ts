export interface GameAccountTicket {
  ownerId: string;
  generation: number;
}

/** Invalidates late list, launch and payment completions after an account switch. */
export class GameAccountScope {
  private ownerId: string;
  private generation = 0;

  constructor(ownerId: string) {
    this.ownerId = ownerId;
  }

  updateOwner(ownerId: string): boolean {
    if (ownerId === this.ownerId) return false;
    this.ownerId = ownerId;
    this.generation += 1;
    return true;
  }

  capture(): GameAccountTicket {
    return { ownerId: this.ownerId, generation: this.generation };
  }

  isCurrent(ticket: GameAccountTicket): boolean {
    return ticket.ownerId === this.ownerId && ticket.generation === this.generation;
  }
}
