import React from 'react'
import WalletConnection from './components/WalletConnection'
import ProgramControls from './components/ProgramControls'

export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>Taxed Token Launchpad (Devnet)</h1>
      <WalletConnection />
      <ProgramControls />
    </div>
  )
}
