import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import './nav.css'

export default function Nav() {
  const { count } = useCart()

  return (
    <header className="site-header">
      <Link to="/" className="logo display">PAUSE</Link>
      <nav>
        <ul>
          <li><a href="#">SHOP</a></li>
          <li><a href="#">DROPS</a></li>
          <li><a href="#">ADVICE</a></li>
          <li><Link to="/cart" className="cart">CART ({count})</Link></li>
        </ul>
      </nav>
    </header>
  )
}
