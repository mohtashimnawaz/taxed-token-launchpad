use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_lang::solana_program::sysvar::rent::Rent;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::pubkey::Pubkey; 

// Import spl-token-2022 instruction constructors and state types
use spl_token_2022::instruction as token_instruction;
use spl_token_2022::state::Mint as Token2022Mint;
use spl_token_2022::extension::transfer_fee::instruction::initialize_transfer_fee_config;

declare_id!("9zZZdmpER8Pw9QJMwSyd8cvV8swbZWeqfJG3Gz2HhVGz");

#[program]
pub mod taxed_token_launchpad {
    use super::*;

    /// Create a new Taxed Token mint with Transfer Fee Extension configured.
    /// The created mint's mint authority will be `mint_authority` and the withdraw authority
    /// for withheld fees will be `fee_withdrawal_authority`.
    pub fn create_taxed_token(
        ctx: Context<CreateTaxedToken>,
        decimals: u8,
        transfer_fee_basis_points: u16,
        maximum_fee: u64,
    ) -> Result<()> {
        // Basic validation
        if transfer_fee_basis_points as u32 > 10_000 {
            return Err(MyError::InvalidFeeConfig.into());
        }

        // Create mint account with required space and rent
        let rent = Rent::get()?;
        let mint_space = Token2022Mint::get_packed_len();
        let lamports = rent.minimum_balance(mint_space);

        invoke(
            &system_instruction::create_account(
                &ctx.accounts.payer.key,
                &ctx.accounts.mint.key,
                lamports,
                mint_space as u64,
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Initialize the mint via token-2022 program CPI
        let init_mint_ix = token_instruction::initialize_mint(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.mint_authority.key(),
            Some(&ctx.accounts.freeze_authority.key()),
            decimals,
        )?;

        invoke(
            &init_mint_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // Initialize the transfer fee config extension
        let init_tf_ix = initialize_transfer_fee_config(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.mint.key(),
            Some(&ctx.accounts.mint_authority.key()),
            Some(&ctx.accounts.fee_withdraw_authority.key()),
            transfer_fee_basis_points,
            maximum_fee,
        )?;

        invoke(
            &init_tf_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.mint_authority.to_account_info(),
                ctx.accounts.fee_withdraw_authority.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        Ok(())
    }

    /// Create a new Soulbound (non-transferable) mint. Tokens can be minted but transfers will fail.
    pub fn create_soulbound_token(
        ctx: Context<CreateSoulboundToken>,
        decimals: u8,
    ) -> Result<()> {
        // Create mint account
        let rent = Rent::get()?;
        let mint_space = Token2022Mint::get_packed_len();
        let lamports = rent.minimum_balance(mint_space);

        invoke(
            &system_instruction::create_account(
                &ctx.accounts.payer.key,
                &ctx.accounts.mint.key,
                lamports,
                mint_space as u64,
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Initialize the mint
        let init_mint_ix = token_instruction::initialize_mint(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.mint_authority.key(),
            Some(&ctx.accounts.freeze_authority.key()),
            decimals,
        )?;

        invoke(
            &init_mint_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // Initialize non-transferable extension
        let init_nt_ix = token_instruction::initialize_non_transferable_mint(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.mint.key(),
        )?;

        invoke(
            &init_nt_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateTaxedToken<'info> {
    /// The payer who funds account creation and will be mint authority by default
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The mint account to be created (passed as system account)
    /// CHECK: this is a Keypair signer for the new mint account
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Authority that will be set as the mint authority
    /// CHECK: this account must be a signer (the mint authority)
    pub mint_authority: Signer<'info>,

    /// Authority that will be allowed to withdraw withheld fees
    /// CHECK: this account must be a signer (fee withdraw authority)
    pub fee_withdraw_authority: Signer<'info>,

    /// Optional freeze authority
    /// CHECK: any pubkey
    pub freeze_authority: UncheckedAccount<'info>,

    /// The token-2022 program
    /// CHECK: must be the SPL Token-2022 program id
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateSoulboundToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The mint account to be created
    /// CHECK: this is a Keypair signer for the new mint account
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Authority that will be set as mint authority
    /// CHECK: this account must be a signer (the mint authority)
    pub mint_authority: Signer<'info>,

    /// Optional freeze authority
    /// CHECK: any pubkey
    pub freeze_authority: UncheckedAccount<'info>,

    /// Token-2022 program
    /// CHECK: must be the SPL Token-2022 program id
    pub token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[error_code]
pub enum MyError {
    #[msg("Invalid fee configuration provided")]
    InvalidFeeConfig,

    #[msg("Failed to initialize mint")]
    MintFailed,

    #[msg("Failed to initialize transfer fee config")]
    TransferFeeInitFailed,

    #[msg("Failed to initialize non-transferable extension")]
    NonTransferableInitFailed,
}
