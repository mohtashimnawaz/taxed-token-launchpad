use anchor_lang::prelude::*;

declare_id!("9zZZdmpER8Pw9QJMwSyd8cvV8swbZWeqfJG3Gz2HhVGz");

#[program]
pub mod taxed_token_launchpad {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
