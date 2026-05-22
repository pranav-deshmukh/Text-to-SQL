export interface DatabaseOption {
  dbId: string;
  displayName: string;
}

export interface DatabaseListResponse {
  databases: DatabaseOption[];
}
