import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity()
export class Confession {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  approved?: boolean;
  @Column()
  viewed?: boolean;
  // Whether "Approve for meta" was selected instead of "Approve"
  @Column({ nullable: true })
  meta?: boolean;

  @Column("text")
  text!: string;
  @Column({ nullable: true })
  tw_text?: string;

  @Column()
  staging_ts?: string;
  @Column()
  published_ts?: string;

  @Column()
  uid_salt!: string;
  @Column()
  uid_hash!: string;

  @Column({ nullable: true })
  user_id?: string;

  // The author's own uploads. Kept so copies can be re-made whenever the
  // confession is published or restaged; never shown to anyone directly.
  @Column("simple-array", { nullable: true })
  image_file_ids?: string[];
  // The bot-owned copies living in the staging channel, used to rebuild the
  // staging message's inline images after an undo or a revive.
  @Column("simple-array", { nullable: true })
  staging_image_file_ids?: string[];
}
